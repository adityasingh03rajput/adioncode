const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Middleware to parse JSON
app.use(express.json({ limit: '10mb' })); // For large base64 images

// Initialize Socket.io with CORS settings
const io = socketIo(server, {
    cors: { 
        origin: '*', // Allow all origins for development; restrict in production
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

// Map for face search: anonymousId -> realSocketId
const faceSearchMap = new Map();

// Store messages temporarily for unsend/edit functionality within an active chat session
// messageId -> { senderId, receiverId, text, timestamp, edited }
const activeMessages = new Map();


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

        // --- Simple preference-based matching logic (can be expanded) ---
        // Current logic: 20% chance for same gender, 80% for different.
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
        // Clear any pending proposals where this user was involved
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
            messageId: data.messageId, // Pass message ID to recipient
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
        io.to(socket.id).emit('message-unsent', { messageId }); // Confirm to sender
        io.to(partnerId).emit('message-unsent', { messageId }); // Notify recipient
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
        message.timestamp = Date.now(); // Update timestamp for edit
        activeMessages.set(messageId, message); // Update the message
        
        io.to(socket.id).emit('message-edited', { messageId, newText }); // Confirm to sender
        io.to(partnerId).emit('message-edited', { messageId, newText }); // Notify recipient
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

            io.to(pending.a).emit('match-confirmed', {
                id: userB.id, username: userB.username, gender: userB.gender, age: userB.age, about: userB.about, interests: userB.interests
            });
            io.to(pending.b).emit('match-confirmed', {
                id: userA.id, username: userA.username, gender: userA.gender, age: userA.age, about: userA.about, interests: userA.interests
            });

            console.log(`[Match Confirmed] ${userA?.username} (${pending.a}) <> ${userB?.username} (${pending.b}).`);
        } else {
            console.log(`[Match Pending] ${socket.id} accepted. Waiting for ${partnerId}. Current state: A:${pending.aAccepted}, B:${pending.bAccepted}.`);
        }
    });

    // Handle rejection of a match proposal
    socket.on('match-reject', ({ partnerId }) => {
        console.log(`[Match Reject] User ${socket.id} rejects match with ${partnerId}.`);
        const key = [socket.id, partnerId].sort().join('|');
        const pending = pendingProposals.get(key);
        
        if (!pending) {
            console.warn(`[Match Reject] No pending proposal found for rejection from ${key}.`);
            return;
        }

        pendingProposals.delete(key);
        io.to(partnerId).emit('match-cancelled'); // Notify the counterpart

        // Try to re-queue both parties for a new match
        const rejector = socketIdToUser.get(socket.id);
        const counterpart = socketIdToUser.get(partnerId);

        const tryRematch = (userToRequeue) => {
            if (!userToRequeue || activePartners.has(userToRequeue.id) || !socketIdToUser.has(userToRequeue.id)) {
                console.log(`[Match Reject] Skipping requeue for ${userToRequeue?.username || 'Unknown'} (${userToRequeue?.id || 'N/A'}).`);
                return; 
            }
            // Remove from waiting list just in case, then try to find new match
            waitingUsers = waitingUsers.filter(wUser => wUser.id !== userToRequeue.id);
            const resolved = findMatch(userToRequeue);
            
            if (resolved) {
                const newKey = [userToRequeue.id, resolved.id].sort().join('|');
                pendingProposals.set(newKey, { a: userToRequeue.id, b: resolved.id, aAccepted: false, bAccepted: false });
                io.to(userToRequeue.id).emit('match-found', {
                    id: resolved.id, username: resolved.username, gender: resolved.gender, age: resolved.age, about: resolved.about, interests: resolved.interests
                });
                io.to(resolved.id).emit('match-found', {
                    id: userToRequeue.id, username: userToRequeue.username, gender: userToRequeue.gender, age: userToRequeue.age, about: userToRequeue.about, interests: userToRequeue.interests
                });
                console.log(`[Match Reject] Re-queued and proposed new match between ${userToRequeue.username} (${userToRequeue.id}) and ${resolved.username} (${resolved.id}).`);
            } else {
                console.log(`[Match Reject] ${userToRequeue.username} (${userToRequeue.id}) re-added to waiting list.`);
            }
        };

        tryRematch(rejector);
        tryRematch(counterpart);
    });

    // Handle typing indicators
    socket.on('typing', ({ to, isTyping }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        socket.to(partnerId).emit('typing', { from: socket.id, isTyping: Boolean(isTyping) });
    });

    // Generic cleanup function for a disconnected socket
    const cleanupUser = (disconnectedSocketId) => {
        const user = socketIdToUser.get(disconnectedSocketId);
        const username = user ? user.username : 'Unknown';
        console.log(`[Cleanup] Initiating cleanup for ${username} (${disconnectedSocketId}).`);

        // Remove from waiting list
        waitingUsers = waitingUsers.filter(wUser => wUser.id !== disconnectedSocketId);
        
        // If in a pending proposal, cancel it and notify counterpart
        for (const [key, p] of pendingProposals) {
            if (p.a === disconnectedSocketId || p.b === disconnectedSocketId) {
                const otherId = p.a === disconnectedSocketId ? p.b : p.a;
                pendingProposals.delete(key);
                if (socketIdToUser.has(otherId)) { // Only notify if other user is still connected
                    io.to(otherId).emit('match-cancelled');
                    console.log(`[Cleanup] Pending proposal for ${otherId} cancelled due to ${disconnectedSocketId} disconnect.`);
                }
            }
        }

        // If in an active conversation, notify partner and clean up activePartners map
        const partnerId = activePartners.get(disconnectedSocketId);
        if (partnerId) {
            activePartners.delete(disconnectedSocketId);
            activePartners.delete(partnerId);
            if (socketIdToUser.has(partnerId)) { // Only notify if partner is still connected
                io.to(partnerId).emit('partner-disconnected');
                console.log(`[Cleanup] Active partner ${partnerId} notified of ${disconnectedSocketId} disconnect.`);
            }
        }

        // Clear temporary messages for this user
        activeMessages.forEach((msg, msgId) => {
            if (msg.senderId === disconnectedSocketId || msg.receiverId === disconnectedSocketId) {
                activeMessages.delete(msgId);
            }
        });

        socketIdToUser.delete(disconnectedSocketId);
        console.log(`[Cleanup] Finished cleanup for ${username} (${disconnectedSocketId}).`);
    };

    // User explicitly requests to disconnect from current session/partner
    socket.on('disconnect-me', () => {
        console.log(`[User Action] User ${socket.id} explicitly requested disconnect.`);
        cleanupUser(socket.id);
    });
    
    // User disconnected (e.g., closed tab, network issue, or server restart)
    socket.on('disconnect', () => {
        console.log(`[Disconnect] User disconnected: ${socket.id}.`);
        cleanupUser(socket.id);
    });

    // --- Follow System ---
    socket.on('follow', ({ userId, username }) => {
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
        console.log(`[Follow] ${follower.username} (${socket.id}) followed ${userId}.`);
    });

    socket.on('unfollow', ({ userId, username }) => {
        const follower = socketIdToUser.get(socket.id);
        // unfollow can happen even if not active partner if implemented in UI for followed friends
        
        // Allow unfollow if the user is in the followed list, regardless of current chat
        if (!follower || !userId || !userFollows.has(socket.id) || !userFollows.get(socket.id).has(userId)) {
             console.warn(`[Unfollow] Invalid unfollow request from ${socket.id} for ${userId}. Not in followed list.`);
             return;
        }

        userFollows.get(socket.id).delete(userId);
        io.to(userId).emit('unfollowed', { by: socket.id, byName: follower.username });
        console.log(`[Unfollow] ${follower.username} (${socket.id}) unfollowed ${userId}.`);
    });

    socket.on('request-followed-status', ({ friendIds }) => {
        const onlineFriends = friendIds.filter(id => socketIdToUser.has(id));
        socket.emit('followed-status-update', { onlineFriends });
        // console.log(`[Status Request] ${socket.id} requested status for followed friends. Online: ${onlineFriends.join(', ')}`); // Removed this log
    });

    socket.on('rechat-request', ({ friendId }) => {
        const requestingUser = socketIdToUser.get(socket.id);
        const targetFriend = socketIdToUser.get(friendId);

        if (!requestingUser) {
            socket.emit('rechat-failed', { reason: 'Your session is invalid.' });
            return;
        }
        if (!targetFriend) {
            socket.emit('rechat-failed', { reason: 'Friend is offline.' });
            return;
        }
        if (!userFollows.has(socket.id) || !userFollows.get(socket.id).has(friendId)) {
            socket.emit('rechat-failed', { reason: 'You are not following this user.' });
            return;
        }
        if (activePartners.has(socket.id) || activePartners.has(friendId)) {
            socket.emit('rechat-failed', { reason: 'One of you is already in an active chat.' });
            return;
        }
        // Ensure they are not in pending proposals or waiting list
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id && u.id !== friendId);
        for (const [key, p] of pendingProposals) {
            if (p.a === socket.id || p.b === socket.id || p.a === friendId || p.b === friendId) {
                pendingProposals.delete(key);
            }
        }

        // Establish direct chat
        activePartners.set(socket.id, friendId);
        activePartners.set(friendId, socket.id);
        console.log(`[Rechat] ${requestingUser.username} (${socket.id}) rechatting with ${targetFriend.username} (${friendId}).`);
    });
});

// --- Admin Namespace for Monitoring and Management ---
const adminNs = io.of('/admin');
adminNs.on('connection', (adminSocket) => {
    console.log(`[Admin] Admin connected: ${adminSocket.id}`);
    // Function to get current user status
    const getUserStatus = (id) => {
        if (bannedIds.has(id)) return 'banned';
        if (activePartners.has(id)) return 'matched';
        if (waitingUsers.some(u => u.id === id)) return 'waiting';
        for (const [key, p] of pendingProposals) {
            if (p.a === id || p.b === id) return 'pending_match';
        }
        return 'online'; // Default for connected but not in specific state
    };

    const listUsers = () => {
        const users = [];
        for (const [id, userProfile] of socketIdToUser.entries()) {
            users.push({
                id: userProfile.id,
                username: userProfile.username,
                age: userProfile.age,
                gender: userProfile.gender,
                status: getUserStatus(userProfile.id),
                partnerId: activePartners.get(userProfile.id) || null
            });
        }
        adminSocket.emit('admin:users', users);
    };

    const listBanned = () => {
        const bannedUsersData = [];
        for (const id of bannedIds) {
            const user = socketIdToUser.get(id); // Check if still connected
            bannedUsersData.push({
                id: id,
                username: user ? user.username : 'Unknown (disconnected)'
            });
        }
        adminSocket.emit('admin:banned', bannedUsersData);
    };

    adminSocket.on('admin:list', () => {
        listUsers();
        listBanned();
        console.log(`[Admin] Admin ${adminSocket.id} requested lists.`);
    });

    adminSocket.on('admin:terminate', ({ id1, id2 }) => {
        if (!id1 || !id2) {
            console.warn(`[Admin] Invalid terminate request from ${adminSocket.id}.`);
            return;
        }
        if (activePartners.get(id1) === id2 && activePartners.get(id2) === id1) {
            console.log(`[Admin] Admin ${adminSocket.id} terminated chat between ${id1} and ${id2}.`);
            // Clean up both users explicitly
            cleanupUser(id1); 
            cleanupUser(id2);
            io.to(id1).emit('partner-disconnected'); // Ensure both clients are notified
            io.to(id2).emit('partner-disconnected');
        } else {
            console.warn(`[Admin] Terminate failed: ${id1} and ${id2} are not active partners.`);
        }
        listUsers(); // Refresh lists for all admins
        listBanned();
        adminNs.emit('admin:stats', getStats()); // Update stats
    });

    adminSocket.on('admin:ban', ({ id }) => {
        if (!id) {
            console.warn(`[Admin] Invalid ban request from ${adminSocket.id}.`);
            return;
        }
        if (!bannedIds.has(id)) {
            bannedIds.add(id);
            console.log(`[Admin] Admin ${adminSocket.id} banned user: ${id}.`);
            io.sockets.sockets.get(id)?.disconnect(true); // Force disconnect the banned user if connected
            cleanupUser(id); // Immediately clean up their state
        }
        listUsers(); // Refresh lists for all admins
        listBanned();
        adminNs.emit('admin:stats', getStats()); // Update stats
    });
    
    adminSocket.on('admin:unban', ({ id }) => {
        if (!id) {
            console.warn(`[Admin] Invalid unban request from ${adminSocket.id}.`);
            return;
        }
        if (bannedIds.delete(id)) {
            console.log(`[Admin] Admin ${adminSocket.id} unbanned user: ${id}.`);
        }
        listUsers(); // Refresh lists for all admins
        listBanned();
        adminNs.emit('admin:stats', getStats()); // Update stats
    });

    const getStats = () => {
        return {
            connectedSockets: io.of('/').sockets.size,
            waitingUsers: waitingUsers.length,
            activePairs: new Set(Array.from(activePartners.values())).size, 
            pendingProposals: pendingProposals.size,
            bannedUsers: bannedIds.size
        };
    };

    adminSocket.on('admin:stats', () => {
        adminSocket.emit('admin:stats', getStats());
    });

    const adminInterval = setInterval(() => {
        listUsers();
        listBanned();
        adminNs.emit('admin:stats', getStats()); // Emit to all connected admins
    }, 3000); // Update every 3 seconds

    adminSocket.on('disconnect', () => {
        console.log(`[Admin] Admin disconnected: ${adminSocket.id}.`);
        clearInterval(adminInterval);
    });
});


// --- Face Search Route ---
app.post('/face-search', (req, res) => {
    const { image, gender } = req.body; // image is base64, gender 'male' or 'female'
    if (!image || !gender) {
        return res.status(400).json({ error: 'Missing image or gender' });
    }

    // Simple matching: find users with matching profilePic and gender
    const matches = [];
    for (const [socketId, user] of socketIdToUser.entries()) {
        if (user.profilePic === image && user.gender === gender) {
            // Create anonymous ID
            const anonymousId = `anon-${Math.random().toString(36).substr(2, 9)}`;
            faceSearchMap.set(anonymousId, socketId);
            matches.push(anonymousId);
        }
    }

    res.json({ matches });
});

// --- Confessions Route ---
app.get('/confessions', (req, res) => {
    res.json({ confessions: confessions });
});

app.post('/confessions', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const confession = { id: Date.now(), text, reactions: { heart: 0, fire: 0, laugh: 0 }, timestamp: Date.now() };
    confessions.push(confession);
    io.emit('new-confession', confession);
    res.json({ success: true });
});

app.post('/confessions/:id/react', (req, res) => {
    const { id } = req.params;
    const { type } = req.body; // heart, fire, laugh
    const conf = confessions.find(c => c.id == id);
    if (!conf) return res.status(404).json({ error: 'Not found' });
    conf.reactions[type]++;
    io.emit('confession-update', { id, reactions: conf.reactions });
    res.json({ success: true });
});

// --- AI Suggestions ---
app.post('/ai-suggest', (req, res) => {
    const { about } = req.body;
    const suggestions = [
        "Based on your interests, you're a creative coder who loves adventure.",
        "You seem like a fun person who enjoys music and games.",
        "Your profile suggests you're thoughtful and kind-hearted."
    ];
    res.json({ suggestion: suggestions[Math.floor(Math.random() * suggestions.length)] });
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
