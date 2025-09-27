const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Middleware to parse JSON
app.use(express.json({ limit: '10mb' })); // For large base64 images

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Initialize Socket.io with CORS settings
const io = socketIo(server, {
    cors: { 
        origin: process.env.NODE_ENV === 'production' ? false : "*", // Allow all for dev
        methods: ['GET', 'POST'] 
    }
});

// Serve the index.html file from the root directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// New route to serve the admin dashboard
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Store users waiting for a match
let waitingUsers = [];
// Track basic user profiles by socket id
const socketIdToUser = new Map();
// Track pending proposals: key is a sorted pair key "idA|idB"
const pendingProposals = new Map();
// Track active confirmed matches: socket id -> partner id
const activePartners = new Map();
// Banned ids to prevent them from rejoining
const bannedIds = new Set();
// Track followed relationships: followerId -> Set of followedUserIds
const userFollows = new Map(); // Stores Set<string> of user IDs that socket.id follows.

// Store messages temporarily for unsend/edit functionality within an active chat session
// messageId -> { senderId, receiverId, text, timestamp, edited }
const activeMessages = new Map();

// Store confessions
let confessions = [];


// --- Matchmaking Algorithm ---
function findMatch(user) {
    console.log(`[Matchmaking] ${user.username} (${user.id}) looking for a match.`);

    // Remove current user from waiting list if they were there (e.g., rejoining after a reject or rechat)
    waitingUsers = waitingUsers.filter(wUser => wUser.id !== user.id);

    // If no one else is waiting, add current user to queue
    if (waitingUsers.length === 0) {
        waitingUsers.push(user);
        console.log(`[Matchmaking] ${user.username} (${user.id}) added to empty waiting list.`);
        return null;
    }
    
    // Simple matchmaking: iterate to find a potential match
    for (let i = 0; i < waitingUsers.length; i++) {
        const potentialMatch = waitingUsers[i];

        // Ensure potentialMatch is still connected and not already matched/pending
        if (!socketIdToUser.has(potentialMatch.id) || activePartners.has(potentialMatch.id)) {
            console.log(`[Matchmaking] Cleaning up stale user ${potentialMatch.username} (${potentialMatch.id}) from waiting list.`);
            waitingUsers.splice(i, 1); // Remove stale user
            i--; // Adjust index due to removal
            continue;
        }

        // Simple preference-based matching logic: 20% chance for same gender, 80% for different.
        const isSameGender = user.gender === potentialMatch.gender;
        const random = Math.random();
        
        if ((isSameGender && random < 0.2) || (!isSameGender && random >= 0.2)) {
            // Found a match!
            waitingUsers.splice(i, 1); // Remove from waiting list
            console.log(`[Matchmaking] Found potential match: ${user.username} (${user.id}) with ${potentialMatch.username} (${potentialMatch.id}).`);
            return potentialMatch;
        }
    }
    
    // If no suitable match found based on preferences, add to queue
    waitingUsers.push(user);
    console.log(`[Matchmaking] ${user.username} (${user.id}) added to waiting list. No immediate match.`);
    return null;
}

// --- Socket.io Connection Handling ---
io.on('connection', (socket) => {
    console.log(`[Connect] User connected: ${socket.id}`);
    
    // Handle a user joining the chat service
    socket.on('join', (userData) => {
        console.log(`[Join] User ${socket.id} attempting to join with data:`, userData);

        if (bannedIds.has(socket.id)) {
            socket.emit('age-restricted'); // Using this event for any ban
            console.warn(`[Join] Banned user ${socket.id} attempted to join.`);
            return;
        }
        
        // Enforce age restriction
        if (typeof userData.age !== 'number' || userData.age < 18) {
            socket.emit('age-restricted');
            console.warn(`[Join] User ${socket.id} (age: ${userData.age}) rejected due to age restriction.`);
            return;
        }

        // Store user profile
        const user = {
            id: socket.id,
            username: userData.username,
            gender: userData.gender,
            age: userData.age,
            about: userData.about,
            interests: userData.interests,
            profilePic: userData.profilePic || null
        };
        socketIdToUser.set(socket.id, user);

        // Clean up any old states for this socket before trying to match
        activePartners.delete(socket.id);
        waitingUsers = waitingUsers.filter(wUser => wUser.id !== socket.id);
        for (const [key, p] of pendingProposals) {
            if (p.a === socket.id || p.b === socket.id) {
                pendingProposals.delete(key);
            }
        }

        // Try to find a partner
        const partner = findMatch(user);

        if (partner) {
            // Create a pending proposal
            const key = [socket.id, partner.id].sort().join('|');
            pendingProposals.set(key, {
                a: socket.id,
                b: partner.id,
                aAccepted: false,
                bAccepted: false
            });

            // Send proposal to both with the other's public profile
            const partnerProfile = { id: partner.id, username: partner.username, gender: partner.gender, age: partner.age, about: partner.about, interests: partner.interests };
            const userProfile = { id: user.id, username: user.username, gender: user.gender, age: user.age, about: user.about, interests: user.interests };

            socket.emit('match-found', partnerProfile);
            io.to(partner.id).emit('match-found', userProfile);

            console.log(`[Join] Proposed match between ${user.username} (${user.id}) and ${partner.username} (${partner.id}).`);
        } else {
            console.log(`[Join] ${user.username} (${user.id}) is waiting for a match.`);
        }
    });
    
    // Handle incoming chat messages
    socket.on('message', (data) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== data.to) {
            console.warn(`[Message] User ${socket.id} tried to message non-partner ${data.to}.`);
            return;
        }
        // Store message temporarily for unsend/edit
        activeMessages.set(data.messageId, {
            senderId: socket.id,
            receiverId: partnerId,
            text: data.message,
            timestamp: Date.now(),
            edited: false
        });
        io.to(partnerId).emit('message', {
            messageId: data.messageId,
            message: data.message,
            from: socket.id
        });
        console.log(`[Message] ${socket.id} sent message ${data.messageId} to ${partnerId}.`);
    });

    // Handle unsend message
    socket.on('unsend-message', ({ messageId, to }) => {
        const partnerId = activePartners.get(socket.id);
        const message = activeMessages.get(messageId);

        if (!message || message.senderId !== socket.id || message.receiverId !== partnerId || partnerId !== to) {
            console.warn(`[Unsend] Invalid unsend request from ${socket.id} for message ${messageId}.`);
            return;
        }

        activeMessages.delete(messageId);
        io.to(socket.id).emit('message-unsent', { messageId });
        io.to(partnerId).emit('message-unsent', { messageId });
        console.log(`[Unsend] Message ${messageId} unsent by ${socket.id}.`);
    });

    // Handle edit message
    socket.on('edit-message', ({ messageId, newText, to }) => {
        const partnerId = activePartners.get(socket.id);
        const message = activeMessages.get(messageId);

        if (!message || message.senderId !== socket.id || message.receiverId !== partnerId || partnerId !== to) {
            console.warn(`[Edit] Invalid edit request from ${socket.id} for message ${messageId}.`);
            return;
        }

        message.text = newText;
        message.edited = true;
        message.timestamp = Date.now();
        activeMessages.set(messageId, message);
        
        io.to(socket.id).emit('message-edited', { messageId, newText });
        io.to(partnerId).emit('message-edited', { messageId, newText });
        console.log(`[Edit] Message ${messageId} edited by ${socket.id}.`);
    });
    
    // Handle acceptance of a match proposal
    socket.on('match-accept', ({ partnerId }) => {
        console.log(`[Match Accept] User ${socket.id} accepts match with ${partnerId}.`);
        const key = [socket.id, partnerId].sort().join('|');
        const pending = pendingProposals.get(key);
        
        if (!pending) {
            console.warn(`[Match Accept] No pending proposal found for ${key}.`);
            return;
        }

        if (pending.a === socket.id) pending.aAccepted = true;
        if (pending.b === socket.id) pending.bAccepted = true;

        if (pending.aAccepted && pending.bAccepted) {
            pendingProposals.delete(key);
            activePartners.set(pending.a, pending.b);
            activePartners.set(pending.b, pending.a);

            const userA = socketIdToUser.get(pending.a);
            const userB = socketIdToUser.get(pending.b);

            io.to(pending.a).emit('match-confirmed', { id: userB.id, username: userB.username, gender: userB.gender, age: userB.age, about: userB.about, interests: userB.interests });
            io.to(pending.b).emit('match-confirmed', { id: userA.id, username: userA.username, gender: userA.gender, age: userA.age, about: userA.about, interests: userA.interests });

            console.log(`[Match Confirmed] ${userA?.username} (${pending.a}) <> ${userB?.username} (${pending.b}).`);
        } else {
            console.log(`[Match Pending] ${socket.id} accepted. Waiting for ${partnerId}.`);
        }
    });

    // Handle rejection of a match proposal
    socket.on('match-reject', ({ partnerId }) => {
        console.log(`[Match Reject] User ${socket.id} rejects match with ${partnerId}.`);
        const key = [socket.id, partnerId].sort().join('|');
        
        if (!pendingProposals.has(key)) {
            console.warn(`[Match Reject] No pending proposal found for rejection from ${key}.`);
            return;
        }

        pendingProposals.delete(key);
        io.to(partnerId).emit('match-cancelled');

        const tryRematch = (userToRequeue) => {
            if (!userToRequeue || activePartners.has(userToRequeue.id) || !socketIdToUser.has(userToRequeue.id)) return;
            waitingUsers = waitingUsers.filter(wUser => wUser.id !== userToRequeue.id);
            const newPartner = findMatch(userToRequeue);
            if (newPartner) {
                const newKey = [userToRequeue.id, newPartner.id].sort().join('|');
                pendingProposals.set(newKey, { a: userToRequeue.id, b: newPartner.id, aAccepted: false, bAccepted: false });
                io.to(userToRequeue.id).emit('match-found', { id: newPartner.id, username: newPartner.username, gender: newPartner.gender, age: newPartner.age, about: newPartner.about, interests: newPartner.interests });
                io.to(newPartner.id).emit('match-found', { id: userToRequeue.id, username: userToRequeue.username, gender: userToRequeue.gender, age: userToRequeue.age, about: userToRequeue.about, interests: userToRequeue.interests });
                console.log(`[Match Reject] Re-queued and proposed new match for ${userToRequeue.username}.`);
            } else {
                console.log(`[Match Reject] ${userToRequeue.username} re-added to waiting list.`);
            }
        };

        tryRematch(socketIdToUser.get(socket.id));
        tryRematch(socketIdToUser.get(partnerId));
    });

    // Handle typing indicators
    socket.on('typing', ({ to, isTyping }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        io.to(partnerId).emit('typing', { from: socket.id, isTyping: Boolean(isTyping) });
    });

    // Generic cleanup function for a user
    const cleanupUser = (disconnectedSocketId) => {
        const username = socketIdToUser.get(disconnectedSocketId)?.username || 'Unknown';
        console.log(`[Cleanup] Initiating cleanup for ${username} (${disconnectedSocketId}).`);

        waitingUsers = waitingUsers.filter(wUser => wUser.id !== disconnectedSocketId);
        
        for (const [key, p] of pendingProposals) {
            if (p.a === disconnectedSocketId || p.b === disconnectedSocketId) {
                const otherId = p.a === disconnectedSocketId ? p.b : p.a;
                pendingProposals.delete(key);
                if (socketIdToUser.has(otherId)) {
                    io.to(otherId).emit('match-cancelled');
                }
            }
        }

        const partnerId = activePartners.get(disconnectedSocketId);
        if (partnerId) {
            activePartners.delete(disconnectedSocketId);
            activePartners.delete(partnerId);
            if (socketIdToUser.has(partnerId)) {
                io.to(partnerId).emit('partner-disconnected');
            }
        }

        activeMessages.forEach((msg, msgId) => {
            if (msg.senderId === disconnectedSocketId || msg.receiverId === disconnectedSocketId) {
                activeMessages.delete(msgId);
            }
        });

        socketIdToUser.delete(disconnectedSocketId);
        console.log(`[Cleanup] Finished for ${username} (${disconnectedSocketId}).`);
    };

    socket.on('disconnect-me', () => {
        console.log(`[User Action] ${socket.id} requested disconnect.`);
        cleanupUser(socket.id);
    });
    
    socket.on('disconnect', () => {
        console.log(`[Disconnect] User disconnected: ${socket.id}.`);
        cleanupUser(socket.id);
    });

    // --- Follow System ---
    socket.on('follow', ({ userId }) => {
        const follower = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!follower || !userId || partnerId !== userId) {
            console.warn(`[Follow] Invalid follow request from ${socket.id} to ${userId}.`);
            return;
        }
        if (!userFollows.has(socket.id)) {
            userFollows.set(socket.id, new Set());
        }
        userFollows.get(socket.id).add(userId);
        io.to(userId).emit('followed', { by: socket.id, byName: follower.username });
        console.log(`[Follow] ${follower.username} followed ${userId}.`);
    });

    socket.on('unfollow', ({ userId }) => {
        const follower = socketIdToUser.get(socket.id);
        if (!follower || !userId || !userFollows.has(socket.id) || !userFollows.get(socket.id).has(userId)) {
             console.warn(`[Unfollow] Invalid unfollow request from ${socket.id} for ${userId}.`);
             return;
        }
        userFollows.get(socket.id).delete(userId);
        io.to(userId).emit('unfollowed', { by: socket.id, byName: follower.username });
        console.log(`[Unfollow] ${follower.username} unfollowed ${userId}.`);
    });

    socket.on('request-followed-status', ({ friendIds }) => {
        const onlineFriends = friendIds.filter(id => socketIdToUser.has(id));
        socket.emit('followed-status-update', { onlineFriends });
    });

    socket.on('rechat-request', ({ friendId }) => {
        const requestingUser = socketIdToUser.get(socket.id);
        const targetFriend = socketIdToUser.get(friendId);

        if (!requestingUser) return socket.emit('rechat-failed', { reason: 'Your session is invalid.' });
        if (!targetFriend) return socket.emit('rechat-failed', { reason: 'Friend is offline.' });
        if (!userFollows.has(socket.id) || !userFollows.get(socket.id).has(friendId)) return socket.emit('rechat-failed', { reason: 'You are not following this user.' });
        if (activePartners.has(socket.id) || activePartners.has(friendId)) return socket.emit('rechat-failed', { reason: 'One of you is already in an active chat.' });
        
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id && u.id !== friendId);
        for (const [key, p] of pendingProposals) {
            if (p.a === socket.id || p.b === socket.id || p.a === friendId || p.b === friendId) {
                pendingProposals.delete(key);
            }
        }

        activePartners.set(socket.id, friendId);
        activePartners.set(friendId, socket.id);
        
        // Notify both users that the rechat has been confirmed and established
        io.to(socket.id).emit('rechat-confirmed', { partnerProfile: { id: targetFriend.id, username: targetFriend.username, gender: targetFriend.gender, age: targetFriend.age, about: targetFriend.about, interests: targetFriend.interests } });
        io.to(friendId).emit('rechat-confirmed', { partnerProfile: { id: requestingUser.id, username: requestingUser.username, gender: requestingUser.gender, age: requestingUser.age, about: requestingUser.about, interests: requestingUser.interests } });
        
        console.log(`[Rechat] ${requestingUser.username} rechatting with ${targetFriend.username}.`);
    });
});

// --- Admin Namespace ---
const adminNs = io.of('/admin');
adminNs.on('connection', (adminSocket) => {
    console.log(`[Admin] Admin connected: ${adminSocket.id}`);
    
    const getUserStatus = (id) => {
        if (bannedIds.has(id)) return 'banned';
        if (activePartners.has(id)) return 'matched';
        if (waitingUsers.some(u => u.id === id)) return 'waiting';
        for (const [key, p] of pendingProposals) {
            if (p.a === id || p.b === id) return 'pending_match';
        }
        return 'online';
    };

    const listAll = () => {
        const users = Array.from(socketIdToUser.values()).map(user => ({
            ...user,
            status: getUserStatus(user.id),
            partnerId: activePartners.get(user.id) || null
        }));
        const bannedUsers = Array.from(bannedIds).map(id => ({
            id,
            username: socketIdToUser.get(id)?.username || 'Unknown (disconnected)'
        }));
        adminSocket.emit('admin:users', users);
        adminSocket.emit('admin:banned', bannedUsers);
    };

    const getStats = () => ({
        connectedSockets: io.of('/').sockets.size,
        waitingUsers: waitingUsers.length,
        activePairs: activePartners.size / 2,
        pendingProposals: pendingProposals.size,
        bannedUsers: bannedIds.size
    });
    
    const updateAllAdmins = () => {
        listAll();
        adminNs.emit('admin:stats', getStats());
    };

    adminSocket.on('admin:list', updateAllAdmins);

    adminSocket.on('admin:terminate', ({ id1, id2 }) => {
        if (!id1 || !id2 || activePartners.get(id1) !== id2) {
            console.warn(`[Admin] Terminate failed: ${id1} and ${id2} are not partners.`);
            return;
        }
        console.log(`[Admin] ${adminSocket.id} terminated chat between ${id1} and ${id2}.`);
        cleanupUser(id1); 
        cleanupUser(id2);
        io.to(id1).emit('partner-disconnected');
        io.to(id2).emit('partner-disconnected');
        updateAllAdmins();
    });

    adminSocket.on('admin:ban', ({ id }) => {
        if (!id || bannedIds.has(id)) return;
        bannedIds.add(id);
        console.log(`[Admin] ${adminSocket.id} banned user: ${id}.`);
        io.sockets.sockets.get(id)?.disconnect(true);
        cleanupUser(id);
        updateAllAdmins();
    });
    
    adminSocket.on('admin:unban', ({ id }) => {
        if (!id || !bannedIds.has(id)) return;
        bannedIds.delete(id);
        console.log(`[Admin] ${adminSocket.id} unbanned user: ${id}.`);
        updateAllAdmins();
    });

    adminSocket.on('admin:stats', () => adminSocket.emit('admin:stats', getStats()));

    const adminInterval = setInterval(updateAllAdmins, 3000);

    adminSocket.on('disconnect', () => {
        console.log(`[Admin] Admin disconnected: ${adminSocket.id}.`);
        clearInterval(adminInterval);
    });
});


// --- Confessions Routes ---
app.get('/confessions', (req, res) => {
    res.json({ confessions });
});

app.post('/confessions', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const confession = { id: Date.now(), text, reactions: { heart: 0, fire: 0, laugh: 0 }, timestamp: Date.now() };
    confessions.unshift(confession); // Add to the beginning
    io.emit('new-confession', confession);
    res.json({ success: true });
});

app.post('/confessions/:id/react', (req, res) => {
    const { id } = req.params;
    const { type } = req.body; // heart, fire, laugh
    const conf = confessions.find(c => c.id == id);
    if (!conf || !conf.reactions.hasOwnProperty(type)) return res.status(404).json({ error: 'Not found or invalid reaction type' });
    conf.reactions[type]++;
    io.emit('confession-update', { id, reactions: conf.reactions });
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
