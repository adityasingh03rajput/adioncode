const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Chess } = require('chess.js'); // Import Chess.js for server-side game logic

const app = express();
const server = http.createServer(app);

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
// Track active games: socket id -> game data (e.g., Chess instance, TTT board, RPS moves)
// Each active game actually has two entries (one for each player) pointing to the same game instance.
const activeGames = new Map();
// Track followed relationships: followerId -> Set of followedUserIds
const userFollows = new Map(); // Stores Set<string> of user IDs that socket.id follows.

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

// --- Game Logic Helper Functions ---

// Checks for a winner in a Tic Tac Toe board
function checkTicTacToeWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6]             // diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // Returns 'X' or 'O' for the winner
        }
    }

    if (board.every(cell => cell !== '')) return 'draw'; // All cells filled, no winner
    return null; // No winner yet
}

// Determines the winner of a Rock Paper Scissors round
function determineRPSWinner(player1Move, player2Move) {
    if (player1Move === player2Move) return 'draw';
    
    const winConditions = {
        'rock': 'scissors',
        'paper': 'rock',
        'scissors': 'paper'
    };
    
    // Player 1 wins if their move beats player 2's move
    return winConditions[player1Move] === player2Move ? 'player1' : 'player2';
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
            interests: userData.interests
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
        // Also clear any active game states for this socket
        if (activeGames.has(socket.id)) {
            const gameData = activeGames.get(socket.id);
            if (gameData.partnerId && activeGames.has(gameData.partnerId)) {
                activeGames.delete(gameData.partnerId);
                io.to(gameData.partnerId).emit('game-ended', { reason: 'Partner started new session' });
                console.log(`[Join] Notified partner ${gameData.partnerId} that ${socket.id} started a new session.`);
            }
            activeGames.delete(socket.id);
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

        // Clean up any active games involving this user
        if (activeGames.has(disconnectedSocketId)) {
            const game = activeGames.get(disconnectedSocketId);
            activeGames.delete(disconnectedSocketId);
            if (game.partnerId && activeGames.has(game.partnerId)) {
                activeGames.delete(game.partnerId); // Remove partner's game entry
                io.to(game.partnerId).emit('game-ended', { reason: 'Partner disconnected' }); // Notify partner
                console.log(`[Cleanup] Active game with ${game.partnerId} ended due to ${disconnectedSocketId} disconnect.`);
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
        // Also clear any active games involving these users
        if (activeGames.has(socket.id)) {
            const gameData = activeGames.get(socket.id);
            if (gameData.partnerId && activeGames.has(gameData.partnerId)) {
                activeGames.delete(gameData.partnerId);
            }
            activeGames.delete(socket.id);
        }
        if (activeGames.has(friendId)) {
            const gameData = activeGames.get(friendId);
            if (gameData.partnerId && activeGames.has(gameData.partnerId)) {
                activeGames.delete(gameData.partnerId);
            }
            activeGames.delete(friendId);
        }

        // Establish direct chat
        activePartners.set(socket.id, friendId);
        activePartners.set(friendId, socket.id);

        io.to(socket.id).emit('rechat-confirmed', { partnerProfile: targetFriend });
        io.to(friendId).emit('rechat-confirmed', { partnerProfile: requestingUser });
        console.log(`[Rechat] ${requestingUser.username} (${socket.id}) rechatting with ${targetFriend.username} (${friendId}).`);
    });


    // Handles when an invitee rejects a game invitation (notifies the inviter)
    socket.on('game-invite-rejected', ({ to, type }) => {
        const inviterSocket = to;
        const inviteeUser = socketIdToUser.get(socket.id);
        if (inviteeUser) {
            io.to(inviterSocket).emit('game-invite-rejected', {
                by: socket.id,
                byName: inviteeUser.username,
                type: type
            });
            console.log(`[Game Invite] ${inviteeUser.username} (${socket.id}) rejected ${type} invite from ${inviterSocket}.`);
        }
        // Clean up the pending game state initiated by the inviter
        if (activeGames.has(inviterSocket)) {
            const gameData = activeGames.get(inviterSocket);
            if (gameData.partnerId && activeGames.has(gameData.partnerId)) {
                activeGames.delete(inviterSocket);
                activeGames.delete(socket.id); // Also remove acceptor's temporary entry if it exists
                console.log(`[Game Cleanup] Cleaned up ${type} game state after rejection.`);
            }
        }
    });


    // --- Chess Game Handlers ---
    socket.on('chess-invite', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[Chess Invite] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        if (activeGames.has(socket.id) || activeGames.has(to)) {
             socket.emit('game-invite-failed', { message: "You or your partner are already in a game or have a pending invite." });
             console.warn(`[Chess Invite] Failed: ${socket.id} or ${to} already in a game/pending.`);
             return;
        }

        const gameInstance = new Chess();
        
        activeGames.set(socket.id, {
            type: 'chess',
            game: gameInstance,
            partnerId: to,
            color: 'white',
            drawOfferBy: null
        });
        
        activeGames.set(to, {
            type: 'chess',
            game: gameInstance,
            partnerId: socket.id,
            color: 'black',
            drawOfferBy: null
        });
        
        io.to(to).emit('chess-invite', { 
            by: socket.id, 
            byName: user.username 
        });
        console.log(`[Chess Invite] ${user.username} (${socket.id}) invited ${to} to chess.`);
    });

    socket.on('chess-accept', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Accept] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameDataInviter = activeGames.get(to);
        const gameDataAcceptor = activeGames.get(socket.id);
        
        if (!gameDataInviter || gameDataInviter.type !== 'chess' || !gameDataAcceptor || gameDataAcceptor.type !== 'chess' || gameDataInviter.game !== gameDataAcceptor.game) {
            console.warn(`[Chess Accept] Failed: Invalid game data for ${socket.id} and ${to}.`);
            return;
        }
        
        io.to(to).emit('chess-start', { color: gameDataInviter.color, fen: gameDataInviter.game.fen() });
        io.to(socket.id).emit('chess-start', { color: gameDataAcceptor.color, fen: gameDataAcceptor.game.fen() });
        console.log(`[Chess Start] Game started between ${to} (white) and ${socket.id} (black).`);
    });

    socket.on('chess-move', ({ to, move }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Move] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);

        if (!gameData || gameData.type !== 'chess' || !partnerGameData) {
            console.warn(`[Chess Move] Failed: No valid game data for ${socket.id}.`);
            return;
        }
        
        try {
            const currentTurnColor = gameData.game.turn() === 'w' ? 'white' : 'black';
            if (currentTurnColor !== gameData.color) {
                console.warn(`[Chess Move] Not ${socket.id}'s turn. Current turn: ${currentTurnColor}.`);
                return;
            }

            const result = gameData.game.move(move);
            if (result) {
                gameData.drawOfferBy = null; // Clear any pending draw offer after a move
                partnerGameData.drawOfferBy = null;

                io.to(to).emit('chess-move', { move: result });
                console.log(`[Chess Move] ${socket.id} to ${to}: ${result.san}`);
                
                if (gameData.game.game_over()) {
                    let outcome = 'draw';
                    if (gameData.game.in_checkmate()) {
                        outcome = gameData.game.turn() === 'w' ? 'black' : 'white'; 
                        console.log(`[Chess End] Checkmate! ${outcome} wins.`);
                    } else if (gameData.game.in_stalemate() || gameData.game.in_threefold_repetition() || gameData.game.insufficient_material() || gameData.game.in_draw()) {
                        outcome = 'draw';
                        console.log(`[Chess End] Draw.`);
                    }
                    
                    io.to(socket.id).emit('chess-game-over', { outcome: outcome === gameData.color ? 'win' : (outcome === 'draw' ? 'draw' : 'lose') });
                    io.to(to).emit('chess-game-over', { outcome: activeGames.get(to).color === outcome ? 'win' : (outcome === 'draw' ? 'draw' : 'lose') });
                    
                    activeGames.delete(socket.id);
                    activeGames.delete(to);
                }
            } else {
                console.warn(`[Chess Move] Invalid move attempted by ${socket.id}:`, move);
            }
        } catch (e) {
            console.error(`[Chess Move] Error processing move from ${socket.id}:`, e);
        }
    });

    socket.on('chess-resign', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Resign] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        io.to(to).emit('chess-resigned');
        io.to(socket.id).emit('chess-resigned'); // Confirm resignation to self
        console.log(`[Chess Resign] ${socket.id} resigned from game against ${to}.`);
        
        activeGames.delete(socket.id);
        activeGames.delete(to);
    });

    // --- Chess Draw Offer Handlers ---
    socket.on('chess-offer-draw', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[Chess Draw Offer] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }

        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);
        if (!gameData || gameData.type !== 'chess' || gameData.game.game_over() || !partnerGameData) {
            console.warn(`[Chess Draw Offer] Failed: No valid chess game or game over for ${socket.id}.`);
            return;
        }

        if (gameData.drawOfferBy) { // Already offered a draw
            console.log(`[Chess Draw Offer] ${socket.id} already has a pending draw offer.`);
            return;
        }
        if (partnerGameData.drawOfferBy === socket.id) { // Opponent already offered to you
            console.log(`[Chess Draw Offer] ${to} already offered draw to ${socket.id}.`);
            return;
        }

        gameData.drawOfferBy = socket.id; // Mark that this player offered a draw
        partnerGameData.drawOfferBy = socket.id; // Mark for partner's game data as well

        io.to(to).emit('chess-draw-offer', { from: socket.id, byName: user.username });
        console.log(`[Chess Draw Offer] ${user.username} (${socket.id}) offered a draw to ${to}.`);
    });

    socket.on('chess-accept-draw', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Draw Accept] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }

        const gameData = activeGames.get(socket.id); // Acceptor's game data
        const inviterGameData = activeGames.get(to); // Inviter's game data

        if (!gameData || gameData.type !== 'chess' || !inviterGameData || inviterGameData.type !== 'chess') {
            console.warn(`[Chess Draw Accept] Failed: No valid chess game for ${socket.id} and ${to}.`);
            return;
        }
        
        // Ensure the draw was offered by the partner (the 'to' player)
        if (gameData.drawOfferBy === to) {
            io.to(socket.id).emit('chess-game-over', { outcome: 'draw' });
            io.to(to).emit('chess-game-over', { outcome: 'draw' });
            console.log(`[Chess End] Chess game between ${socket.id} and ${to} ended in a draw by agreement.`);
            
            activeGames.delete(socket.id);
            activeGames.delete(to);
        } else {
            console.warn(`[Chess Draw Accept] Failed: No pending offer from ${to} to ${socket.id}.`);
        }
    });

    socket.on('chess-reject-draw', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Draw Reject] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }

        const gameData = activeGames.get(socket.id); // Rejector's game data
        const inviterGameData = activeGames.get(to); // Inviter's game data

        if (!gameData || gameData.type !== 'chess' || !inviterGameData || inviterGameData.type !== 'chess') {
            console.warn(`[Chess Draw Reject] Failed: No valid chess game for ${socket.id} and ${to}.`);
            return;
        }

        // Ensure the draw was offered by the partner (the 'to' player)
        if (gameData.drawOfferBy === to) {
            gameData.drawOfferBy = null; // Clear offer for rejector
            inviterGameData.drawOfferBy = null; // Clear offer for inviter
            io.to(to).emit('chess-draw-rejected', { from: socket.id, byName: socketIdToUser.get(socket.id)?.username || 'Opponent' });
            console.log(`[Chess Draw Reject] ${socket.id} rejected draw offer from ${to}.`);
        } else {
            console.warn(`[Chess Draw Reject] Failed: No pending offer from ${to} to ${socket.id}.`);
        }
    });


    // --- Tic Tac Toe Handlers ---
    socket.on('ttt-invite', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[TTT Invite] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        if (activeGames.has(socket.id) || activeGames.has(to)) {
             socket.emit('game-invite-failed', { message: "You or your partner are already in a game or have a pending invite." });
             console.warn(`[TTT Invite] Failed: ${socket.id} or ${to} already in a game/pending.`);
             return;
        }

        const board = ['', '', '', '', '', '', '', '', '']; // Empty TTT board
        const initialTurn = 'X'; // 'X' always starts
        
        activeGames.set(socket.id, {
            type: 'ttt',
            board: board, // Shared board reference
            partnerId: to,
            mark: 'X',
            currentTurn: initialTurn
        });
        
        activeGames.set(to, {
            type: 'ttt',
            board: board,
            partnerId: socket.id,
            mark: 'O',
            currentTurn: initialTurn
        });
        
        io.to(to).emit('ttt-invite', { 
            by: socket.id, 
            byName: user.username 
        });
        console.log(`[TTT Invite] ${user.username} (${socket.id}) invited ${to} to Tic Tac Toe.`);
    });

    socket.on('ttt-accept', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[TTT Accept] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameDataInviter = activeGames.get(to);
        const gameDataAcceptor = activeGames.get(socket.id);
        
        if (!gameDataInviter || gameDataInviter.type !== 'ttt' || !gameDataAcceptor || gameDataAcceptor.type !== 'ttt' || gameDataInviter.board !== gameDataAcceptor.board) {
            console.warn(`[TTT Accept] Failed: Invalid game data for ${socket.id} and ${to}.`);
            return;
        }
        
        io.to(to).emit('ttt-start', { 
            you: gameDataInviter.mark, 
            board: gameDataInviter.board,
            currentTurn: gameDataInviter.currentTurn
        });
        io.to(socket.id).emit('ttt-start', { 
            you: gameDataAcceptor.mark, 
            board: gameDataAcceptor.board,
            currentTurn: gameDataAcceptor.currentTurn
        });
        console.log(`[TTT Start] Game started between ${to} (X) and ${socket.id} (O).`);
    });

    socket.on('ttt-move', ({ to, idx }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[TTT Move] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);

        if (!gameData || gameData.type !== 'ttt' || !partnerGameData) {
            console.warn(`[TTT Move] Failed: No valid game data for ${socket.id}.`);
            return;
        }
        
        // Validate move: check if cell is empty, idx is valid, and it's the player's turn
        if (gameData.board[idx] !== '' || idx < 0 || idx > 8 || gameData.currentTurn !== gameData.mark) {
            console.warn(`[TTT Move] Invalid move by ${socket.id}: idx=${idx}, currentTurn=${gameData.currentTurn}, playerMark=${gameData.mark}.`);
            return;
        }
        
        // Make the move on the shared board
        gameData.board[idx] = gameData.mark;
        console.log(`[TTT Move] ${socket.id} (mark: ${gameData.mark}) moved to idx ${idx}.`);
        
        // Check for winner after the move
        const winner = checkTicTacToeWinner(gameData.board);

        if (winner) {
            let outcomeForSender = (winner === 'draw') ? 'draw' : (winner === gameData.mark ? 'win' : 'lose');
            let outcomeForPartner = (winner === 'draw') ? 'draw' : (winner === partnerGameData.mark ? 'win' : 'lose');
            
            io.to(socket.id).emit('ttt-game-over', { outcome: outcomeForSender });
            io.to(to).emit('ttt-game-over', { outcome: outcomeForPartner });
            console.log(`[TTT End] Game over. Winner: ${winner}.`);
            
            activeGames.delete(socket.id);
            activeGames.delete(to);
        } else {
            // No winner yet, switch turn
            gameData.currentTurn = (gameData.mark === 'X' ? 'O' : 'X');
            partnerGameData.currentTurn = gameData.currentTurn;

            // Send move to partner (to update their board)
            io.to(to).emit('ttt-move', { idx, mark: gameData.mark });
            
            // Update turn for both players
            io.to(socket.id).emit('ttt-update-turn', { currentTurn: gameData.currentTurn, yourMark: gameData.mark });
            io.to(to).emit('ttt-update-turn', { currentTurn: partnerGameData.currentTurn, yourMark: partnerGameData.mark });
        }
    });

    socket.on('ttt-reset', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[TTT Reset] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);

        if (!gameData || gameData.type !== 'ttt' || !partnerGameData) {
            console.warn(`[TTT Reset] Failed: No valid game data for ${socket.id}.`);
            return;
        }
        
        const newBoard = ['', '', '', '', '', '', '', '', ''];
        gameData.board.splice(0, gameData.board.length, ...newBoard); // Modify in place
        partnerGameData.board.splice(0, partnerGameData.board.length, ...newBoard);

        gameData.currentTurn = 'X';
        partnerGameData.currentTurn = 'X';
        
        io.to(socket.id).emit('ttt-reset');
        io.to(to).emit('ttt-reset');

        io.to(socket.id).emit('ttt-update-turn', { currentTurn: gameData.currentTurn, yourMark: gameData.mark });
        io.to(to).emit('ttt-update-turn', { currentTurn: partnerGameData.currentTurn, yourMark: partnerGameData.mark });
        console.log(`[TTT Reset] Game between ${socket.id} and ${to} reset.`);
    });

    // --- Rock Paper Scissors Handlers ---
    socket.on('rps-invite', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[RPS Invite] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        if (activeGames.has(socket.id) || activeGames.has(to)) {
             socket.emit('game-invite-failed', { message: "You or your partner are already in a game or have a pending invite." });
             console.warn(`[RPS Invite] Failed: ${socket.id} or ${to} already in a game/pending.`);
             return;
        }

        activeGames.set(socket.id, {
            type: 'rps',
            partnerId: to,
            move: null
        });
        
        activeGames.set(to, {
            type: 'rps',
            partnerId: socket.id,
            move: null
        });
        
        io.to(to).emit('rps-invite', { 
            by: socket.id, 
            byName: user.username 
        });
        console.log(`[RPS Invite] ${user.username} (${socket.id}) invited ${to} to Rock Paper Scissors.`);
    });

    socket.on('rps-accept', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[RPS Accept] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameDataInviter = activeGames.get(to);
        const gameDataAcceptor = activeGames.get(socket.id);
        
        if (!gameDataInviter || gameDataInviter.type !== 'rps' || !gameDataAcceptor || gameDataAcceptor.type !== 'rps') {
            console.warn(`[RPS Accept] Failed: Invalid game data for ${socket.id} and ${to}.`);
            return;
        }
        
        io.to(to).emit('rps-start');
        io.to(socket.id).emit('rps-start');
        console.log(`[RPS Start] Game started between ${to} and ${socket.id}.`);
    });

    socket.on('rps-move', ({ to, move }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[RPS Move] Failed: ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        if (!gameData || gameData.type !== 'rps' || gameData.move !== null) {
            console.warn(`[RPS Move] Failed: ${socket.id} already moved or not in game.`);
            return;
        }
        
        gameData.move = move;
        console.log(`[RPS Move] ${socket.id} chose ${move}.`);
        io.to(to).emit('rps-opponent-moved'); // Notify opponent that this player has moved
        
        const partnerGameData = activeGames.get(to);
        if (partnerGameData && partnerGameData.move) {
            const winner = determineRPSWinner(gameData.move, partnerGameData.move);
            
            let outcomeForSender, outcomeForPartner;
            if (winner === 'draw') {
                outcomeForSender = outcomeForPartner = 'draw';
            } else if (winner === 'player1') { // gameData (sender) is player1
                outcomeForSender = 'win';
                outcomeForPartner = 'lose';
            } else { // partnerGameData (to) is player2
                outcomeForSender = 'lose';
                outcomeForPartner = 'win';
            }
            
            io.to(socket.id).emit('rps-result', { 
                outcome: outcomeForSender, 
                yourMove: gameData.move, 
                opponentMove: partnerGameData.move 
            });
            
            io.to(to).emit('rps-result', { 
                outcome: outcomeForPartner, 
                yourMove: partnerGameData.move, 
                opponentMove: gameData.move 
            });
            console.log(`[RPS End] Result between ${socket.id} (chose ${gameData.move}) and ${to} (chose ${partnerGameData.move}). Winner: ${winner}.`);
            
            activeGames.delete(socket.id);
            activeGames.delete(to);
        }
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
        if (activeGames.has(id)) return 'in_game';
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
            activeGames: new Set(Array.from(activeGames.values()).map(game => game.game || game.board || game.partnerId)).size,
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


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
