const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS for Render deployment
const io = new Server(server, {
    cors: {
        origin: [
            "https://google-8j5x.onrender.com", // Your Render deployment URL
            "http://localhost:3000",            // For local development
            "http://127.0.0.1:3000"             // For local development
        ],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files (like index.html) from the current directory
app.use(express.static(path.join(__dirname)));

// Basic root route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Server-side State Management ---
// Store all connected users by their socket.id
const users = new Map(); // socket.id -> { profile, socket, partnerId, chatStatus, followedBy: Set, following: Set }

// Queue for users actively searching for a match
let waitingUsers = []; // Array of socket.ids

/**
 * Finds a suitable partner from the waiting list.
 * Currently, it's a simple FIFO approach, but could be extended with matching logic.
 * @param {string} currentUserSocketId - The socket ID of the current user.
 * @returns {object|null} The profile object of a potential partner, or null if none found.
 */
function findPartner(currentUserSocketId) {
    for (let i = 0; i < waitingUsers.length; i++) {
        const partnerSocketId = waitingUsers[i];
        const partnerUser = users.get(partnerSocketId);

        // Ensure partner exists, is not the current user, and is still searching
        if (partnerUser && partnerSocketId !== currentUserSocketId && partnerUser.chatStatus === 'searching') {
            return partnerUser;
        }
    }
    return null;
}

/**
 * Removes a user's socket ID from the waiting list.
 * @param {string} socketId - The socket ID to remove.
 */
function removeUserFromWaitingList(socketId) {
    waitingUsers = waitingUsers.filter(id => id !== socketId);
}

/**
 * Resets a user's chat-related state.
 * @param {string} socketId - The socket ID of the user to reset.
 */
function resetUserState(socketId) {
    const user = users.get(socketId);
    if (user) {
        user.partnerId = null;
        user.chatStatus = 'searching'; // Put back into searching state
        removeUserFromWaitingList(socketId);
        waitingUsers.push(socketId);
        user.following = new Set(); // Clear follow status
        user.followedBy = new Set();
        console.log(`User ${user.profile.username} (${socketId}) reset to searching state.`);
    }
}

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // JOIN event: User submits their profile and starts searching
    socket.on('join', (profile) => {
        if (profile.age < 18) {
            socket.emit('age-restricted');
            console.log(`User ${profile.username} (${socket.id}) age restricted.`);
            return;
        }

        const userProfile = {
            id: socket.id,
            username: profile.username,
            gender: profile.gender,
            age: profile.age,
            status: profile.status,
            about: profile.about,
            interests: profile.interests,
            socket: socket,
            partnerId: null,
            chatStatus: 'searching', // searching, pending_match, pending_match_accepted, matched
            followedBy: new Set(),
            following: new Set()
        };
        users.set(socket.id, userProfile);
        removeUserFromWaitingList(socket.id); // Ensure user isn't duplicated
        waitingUsers.push(socket.id);
        console.log(`User ${profile.username} (${socket.id}) joined and is searching. Waiting users: ${waitingUsers.length}`);

        // Attempt to find an immediate partner
        const partnerCandidate = findPartner(socket.id);

        if (partnerCandidate) {
            console.log(`Found partner candidate: ${partnerCandidate.username} for ${userProfile.username}`);

            // Remove both from waiting list for now as they are in a match negotiation
            removeUserFromWaitingList(socket.id);
            removeUserFromWaitingList(partnerCandidate.id);

            // Set temporary pending state for both
            userProfile.chatStatus = 'pending_match';
            partnerCandidate.chatStatus = 'pending_match';

            userProfile.partnerId = partnerCandidate.id; // Store pending partner ID
            partnerCandidate.partnerId = socket.id; // Store pending partner ID

            // Send match proposal to both
            socket.emit('match-found', {
                id: partnerCandidate.id,
                username: partnerCandidate.username,
                gender: partnerCandidate.gender,
                age: partnerCandidate.age,
                about: partnerCandidate.about,
                interests: partnerCandidate.interests
            });
            partnerCandidate.socket.emit('match-found', {
                id: userProfile.id,
                username: userProfile.username,
                gender: userProfile.gender,
                age: userProfile.age,
                about: userProfile.about,
                interests: userProfile.interests
            });
            console.log(`Sent match-found to ${userProfile.username} and ${partnerCandidate.username}.`);
        } else {
            console.log(`No immediate partner for ${userProfile.username}. Added to waiting list.`);
        }
    });

    // MATCH ACCEPT event: User accepts a proposed match
    socket.on('match-accept', ({ partnerId }) => {
        const currentUser = users.get(socket.id);
        const partnerUser = users.get(partnerId);

        if (currentUser && partnerUser && currentUser.partnerId === partnerId && partnerUser.partnerId === socket.id) {
            if (partnerUser.chatStatus === 'pending_match_accepted') {
                // Both accepted - establish match
                currentUser.chatStatus = 'matched';
                partnerUser.chatStatus = 'matched';

                // Ensure partnerId is set correctly as confirmed
                currentUser.partnerId = partnerId;
                partnerUser.partnerId = socket.id;

                console.log(`Match confirmed between ${currentUser.username} and ${partnerUser.username}`);
                socket.emit('match-confirmed', {
                    id: partnerUser.id,
                    username: partnerUser.username,
                    gender: partnerUser.gender,
                    age: partnerUser.age,
                    about: partnerUser.about,
                    interests: partnerUser.interests
                });
                partnerUser.socket.emit('match-confirmed', {
                    id: currentUser.id,
                    username: currentUser.username,
                    gender: currentUser.gender,
                    age: currentUser.age,
                    about: currentUser.about,
                    interests: currentUser.interests
                });
            } else {
                // Current user accepted, but partner hasn't yet. Set status and wait.
                currentUser.chatStatus = 'pending_match_accepted';
                console.log(`${currentUser.username} (${socket.id}) accepted match with ${partnerUser.username} (${partnerId}), waiting for partner...`);
            }
        } else {
            console.warn(`Invalid match acceptance attempt by ${socket.id} for partner ${partnerId}. Re-entering search.`);
            if (currentUser) {
                resetUserState(socket.id); // Reset user and put back in searching
                socket.emit('match-cancelled'); // Notify client to restart search
            }
        }
    });

    // MATCH REJECT event: User rejects a proposed match
    socket.on('match-reject', ({ partnerId }) => {
        const currentUser = users.get(socket.id);
        const partnerUser = users.get(partnerId);

        if (currentUser) {
            console.log(`${currentUser.username} (${socket.id}) rejected match with ${partnerId}.`);
            resetUserState(socket.id); // Reset current user and put back into waiting list
            socket.emit('match-cancelled'); // Confirm to client it's back to searching

            // Notify the other user that the match was cancelled
            if (partnerUser && partnerUser.partnerId === socket.id) { // Ensure they were actually negotiating
                console.log(`${partnerUser.username} (${partnerId}) match cancelled by ${currentUser.username}.`);
                resetUserState(partnerId); // Reset partner and put back into waiting list
                partnerUser.socket.emit('match-cancelled');
            }
        }
    });

    // MESSAGE event: User sends a chat message
    socket.on('message', (data) => {
        const sender = users.get(socket.id);
        if (sender && sender.partnerId && sender.chatStatus === 'matched') {
            const partnerSocket = users.get(sender.partnerId)?.socket;
            if (partnerSocket) {
                partnerSocket.emit('message', { message: data.message });
                console.log(`Message from ${sender.username} to ${users.get(sender.partnerId).username}: ${data.message}`);
            } else {
                console.warn(`Partner socket not found for message from ${sender.username}.`);
            }
        } else {
            console.warn(`Message from ${socket.id} but no active partner or not matched.`);
        }
    });

    // TYPING event: User typing status
    socket.on('typing', (data) => {
        const sender = users.get(socket.id);
        if (sender && sender.partnerId && sender.chatStatus === 'matched') {
            const partnerSocket = users.get(sender.partnerId)?.socket;
            if (partnerSocket) {
                partnerSocket.emit('typing', { isTyping: data.isTyping });
            }
        }
    });

    // DISCONNECT-ME event: User explicitly disconnects from current chat (but stays online, searching)
    socket.on('disconnect-me', () => {
        const currentUser = users.get(socket.id);
        if (currentUser && currentUser.partnerId) {
            console.log(`${currentUser.username} (${socket.id}) explicitly disconnected from current partner.`);
            const partnerId = currentUser.partnerId;
            const partnerUser = users.get(partnerId);

            // Reset current user's state (will be put back into searching by resetUserState)
            resetUserState(socket.id);

            // Notify partner and reset their state
            if (partnerUser) {
                resetUserState(partnerId); // Partner also goes back to searching
                partnerUser.socket.emit('partner-disconnected'); // Notify partner
                console.log(`Notified ${partnerUser.username} (${partnerId}) that their partner disconnected.`);
            }
        } else {
            // If they weren't matched but clicked disconnect, just reset their state to searching
            if (currentUser && currentUser.chatStatus !== 'searching') {
                console.log(`${currentUser.username} (${socket.id}) disconnected while not matched.`);
                resetUserState(socket.id);
            }
        }
    });

    // FOLLOW event
    socket.on('follow', ({ userId }) => {
        const follower = users.get(socket.id);
        const followed = users.get(userId);

        if (follower && followed && follower.partnerId === userId && follower.chatStatus === 'matched') {
            follower.following.add(userId);
            followed.followedBy.add(socket.id);
            followed.socket.emit('followed', { byId: socket.id, byName: follower.username });
            console.log(`${follower.username} (${socket.id}) followed ${followed.username} (${userId})`);
        }
    });

    // UNFOLLOW event
    socket.on('unfollow', ({ userId }) => {
        const unfollower = users.get(socket.id);
        const unfollowed = users.get(userId);

        if (unfollower && unfollowed && unfollower.partnerId === userId && unfollower.chatStatus === 'matched') {
            unfollower.following.delete(userId);
            unfollowed.followedBy.delete(socket.id);
            followed.socket.emit('unfollowed', { byId: socket.id, byName: unfollower.username });
            console.log(`${unfollower.username} (${socket.id}) unfollowed ${unfollowed.username} (${userId})`);
        }
    });

    // DISCONNECT event: User disconnects from the server (e.g., closes tab, refresh)
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const disconnectedUser = users.get(socket.id);

        if (disconnectedUser) {
            // Remove from active users and waiting list
            users.delete(socket.id);
            removeUserFromWaitingList(socket.id);

            // If user was pending a match, clear partner's pending state
            if (disconnectedUser.chatStatus === 'pending_match' || disconnectedUser.chatStatus === 'pending_match_accepted') {
                if (disconnectedUser.partnerId && users.has(disconnectedUser.partnerId)) {
                    const partnerUser = users.get(disconnectedUser.partnerId);
                    if (partnerUser && (partnerUser.partnerId === disconnectedUser.id)) {
                        console.log(`Notified ${partnerUser.username} (${partnerUser.id}) that pending match with ${disconnectedUser.username} (${disconnectedUser.id}) cancelled.`);
                        resetUserState(partnerUser.id);
                        partnerUser.socket.emit('match-cancelled');
                    }
                }
            }
            // If user was actively matched, notify partner and reset partner's state
            else if (disconnectedUser.partnerId && disconnectedUser.chatStatus === 'matched') {
                const partnerUser = users.get(disconnectedUser.partnerId);
                if (partnerUser) {
                    resetUserState(partnerUser.id); // Partner also goes back to searching
                    partnerUser.socket.emit('partner-disconnected');
                    console.log(`Notified ${partnerUser.username} (${partnerUser.id}) that ${disconnectedUser.username} (${disconnectedUser.id}) disconnected.`);
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
