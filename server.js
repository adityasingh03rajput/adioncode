const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET','POST'] }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store users waiting for a match
let waitingUsers = [];
// Track basic user profiles by socket id
const socketIdToUser = new Map();
// Track pending proposals: key is a sorted pair key "idA|idB"
const pendingProposals = new Map();
// Track active confirmed matches: socket id -> partner id
const activePartners = new Map();
// Banned ids
const bannedIds = new Set();

// Matchmaking algorithm
function findMatch(user) {
    // If no one is waiting, add to queue
    if (waitingUsers.length === 0) {
        waitingUsers.push(user);
        return null;
    }
    
    // Try to find a match based on gender preferences
    for (let i = 0; i < waitingUsers.length; i++) {
        const potentialMatch = waitingUsers[i];
        const random = Math.random();
        
        // 20% chance for same gender, 80% for different
        const isSameGender = user.gender === potentialMatch.gender;
        
        if ((isSameGender && random < 0.2) || (!isSameGender && random >= 0.2)) {
            // Remove from waiting list
            waitingUsers.splice(i, 1);
            return potentialMatch;
        }
    }
    
    // If no match found, add to queue
    waitingUsers.push(user);
    return null;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join', (userData) => {
        if (bannedIds.has(socket.id)) {
            socket.emit('age-restricted');
            return;
        }
        // Enforce age restriction if provided
        if (typeof userData.age === 'number' && userData.age < 18) {
            socket.emit('age-restricted');
            return;
        }

        // Add socket ID to user data and persist
        const user = {
            id: socket.id,
            username: userData.username,
            gender: userData.gender,
            age: userData.age,
            about: userData.about,
            interests: userData.interests,
            status: userData.status
        };
        socketIdToUser.set(socket.id, user);

        // If user was in any prior state, clear it
        activePartners.delete(socket.id);
        for (const [key, p] of pendingProposals) {
            if (p.a === socket.id || p.b === socket.id) {
                pendingProposals.delete(key);
            }
        }

        // Try to find a partner
        const partner = findMatch(user);

        if (partner) {
            // Create a pending proposal requiring both users to accept
            const key = [socket.id, partner.id].sort().join('|');
            pendingProposals.set(key, {
                a: socket.id,
                b: partner.id,
                aAccepted: false,
                bAccepted: false
            });

            // Send proposal to both with the other's public profile
            socket.emit('match-found', {
                id: partner.id,
                username: partner.username,
                gender: partner.gender,
                age: partner.age,
                about: partner.about,
                interests: partner.interests
            });
            io.to(partner.id).emit('match-found', {
                id: user.id,
                username: user.username,
                gender: user.gender,
                age: user.age,
                about: user.about,
                interests: user.interests
            });

            console.log(`Proposed match between ${user.username} and ${partner.username}`);
        } else {
            socket.emit('waiting');
            console.log(`${user.username} (${user.gender}) added to waiting list`);
        }
    });
    
    socket.on('message', (data) => {
        // Only allow messages to confirmed partners
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== data.to) return;
        socket.to(partnerId).emit('message', {
            message: data.message,
            from: socket.id
        });
    });
    
    socket.on('match-accept', ({ partnerId }) => {
        const key = [socket.id, partnerId].sort().join('|');
        const pending = pendingProposals.get(key);
        if (!pending) return;

        if (pending.a === socket.id) pending.aAccepted = true;
        if (pending.b === socket.id) pending.bAccepted = true;

        if (pending.aAccepted && pending.bAccepted) {
            // Confirm match
            pendingProposals.delete(key);
            activePartners.set(pending.a, pending.b);
            activePartners.set(pending.b, pending.a);

            const userA = socketIdToUser.get(pending.a);
            const userB = socketIdToUser.get(pending.b);

            io.to(pending.a).emit('match-confirmed', {
                id: userB.id, username: userB.username, gender: userB.gender, age: userB.age, about: userB.about, interests: userB.interests
            });
            io.to(pending.b).emit('match-confirmed', {
                id: userA.id, username: userA.username, gender: userA.gender, age: userA.age, about: userA.about, interests: userA.interests
            });

            console.log(`Match confirmed: ${userA?.username} <> ${userB?.username}`);
        }
    });

    socket.on('match-reject', ({ partnerId }) => {
        const key = [socket.id, partnerId].sort().join('|');
        const pending = pendingProposals.get(key);
        if (!pending) return;

        pendingProposals.delete(key);
        // Notify counterpart and re-queue them if still connected
        io.to(partnerId).emit('match-cancelled');

        // Try to requeue both parties for a new match
        const rejector = socketIdToUser.get(socket.id);
        const counterpart = socketIdToUser.get(partnerId);

        const tryRematch = (user) => {
            if (!user) return;
            const resolved = findMatch(user);
            if (resolved) {
                const newKey = [user.id, resolved.id].sort().join('|');
                pendingProposals.set(newKey, { a: user.id, b: resolved.id, aAccepted: false, bAccepted: false });
                io.to(user.id).emit('match-found', {
                    id: resolved.id, username: resolved.username, gender: resolved.gender, age: resolved.age, about: resolved.about, interests: resolved.interests
                });
                io.to(resolved.id).emit('match-found', {
                    id: user.id, username: user.username, gender: user.gender, age: user.age, about: user.about, interests: user.interests
                });
            }
        };

        tryRematch(rejector);
        tryRematch(counterpart);
    });

    socket.on('typing', ({ to, isTyping }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        socket.to(partnerId).emit('typing', { from: socket.id, isTyping: Boolean(isTyping) });
    });

    socket.on('disconnect-me', () => {
        // Remove user from waiting list if they're there
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        // If in a pending proposal, cancel it and notify counterpart
        for (const [key, p] of pendingProposals) {
            if (p.a === socket.id || p.b === socket.id) {
                const otherId = p.a === socket.id ? p.b : p.a;
                pendingProposals.delete(key);
                io.to(otherId).emit('match-cancelled');
            }
        }

        // If in an active conversation, notify partner
        const partnerId = activePartners.get(socket.id);
        if (partnerId) {
            activePartners.delete(socket.id);
            activePartners.delete(partnerId);
            io.to(partnerId).emit('partner-disconnected');
        }

        console.log('User requested disconnect:', socket.id);
    });
    
    socket.on('disconnect', () => {
        // Remove user from waiting list if they're there
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        // If in a pending proposal, cancel it and notify counterpart
        for (const [key, p] of pendingProposals) {
            if (p.a === socket.id || p.b === socket.id) {
                const otherId = p.a === socket.id ? p.b : p.a;
                pendingProposals.delete(key);
                io.to(otherId).emit('match-cancelled');
            }
        }

        // If in an active conversation, notify partner
        const partnerId = activePartners.get(socket.id);
        if (partnerId) {
            activePartners.delete(socket.id);
            activePartners.delete(partnerId);
            io.to(partnerId).emit('partner-disconnected');
        }

        socketIdToUser.delete(socket.id);
        console.log('User disconnected:', socket.id);
    });

// Admin namespace (no message content visibility)
const adminNs = io.of('/admin');
adminNs.on('connection', (adminSocket) => {
    const listPairs = () => {
        const result = [];
        for (const [a, b] of activePartners) {
            if (a < b) {
                const aUser = socketIdToUser.get(a) || { username: a };
                const bUser = socketIdToUser.get(b) || { username: b };
                result.push({ a, b, aName: aUser.username, bName: bUser.username });
            }
        }
        adminSocket.emit('admin:pairs', result);
    };

    adminSocket.on('admin:list', listPairs);

    adminSocket.on('admin:terminate', ({ a, b }) => {
        if (!a || !b) return;
        if (activePartners.get(a) === b && activePartners.get(b) === a) {
            activePartners.delete(a);
            activePartners.delete(b);
            io.to(a).emit('partner-disconnected');
            io.to(b).emit('partner-disconnected');
        }
        listPairs();
    });

    adminSocket.on('admin:ban', ({ id }) => {
        if (!id) return;
        bannedIds.add(id);
        io.to(id).disconnectSockets(true);
        listPairs();
    });
    adminSocket.on('admin:unban', ({ id }) => {
        if (!id) return;
        bannedIds.delete(id);
        listPairs();
    });
});
    // Follow system (simple relay, no persistence)
    socket.on('follow', ({ userId }) => {
        const follower = socketIdToUser.get(socket.id);
        if (!follower || !userId) return;
        io.to(userId).emit('followed', { by: socket.id, byName: follower.username });
    });

    socket.on('unfollow', ({ userId }) => {
        const follower = socketIdToUser.get(socket.id);
        if (!follower || !userId) return;
        io.to(userId).emit('unfollowed', { by: socket.id, byName: follower.username });
    });

    // Chess ephemeral game relay
    socket.on('chess-invite', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        if (!user || !to) return;
        // Only allow inviting confirmed partner
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        io.to(to).emit('chess-invite', { by: socket.id, byName: user.username });
    });

    socket.on('chess-accept', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        // Start the game, white is the inviter (to receives start as white? We'll make inviter white)
        io.to(to).emit('chess-start', { color: 'white' });
        io.to(socket.id).emit('chess-start', { color: 'black' });
    });

    socket.on('chess-move', ({ to, move }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        io.to(to).emit('chess-move', { move });
    });

    socket.on('chess-resign', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        io.to(to).emit('chess-resign');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
