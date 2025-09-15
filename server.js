const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Chess } = require('chess.js'); // Import Chess.js for server-side game logic

const app = express();
const server = http.createServer(app);

// --- Serve Static Files ---
// This line tells Express to serve static assets (like index.html, CSS, JS)
// from the 'public' directory. This is the fix for the ENOENT error.
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Socket.io with CORS settings
const io = socketIo(server, {
    cors: { 
        origin: '*', // Allow all origins for development; restrict in production
        methods: ['GET', 'POST'] 
    }
});

// --- Server State Management ---
let waitingUsers = []; // Array of user objects waiting for a match
const socketIdToUser = new Map(); // Maps socket.id to full user profile object
const pendingProposals = new Map(); // Stores pending match proposals: "idA|idB" -> { a, b, aAccepted, bAccepted }
const activePartners = new Map(); // Stores active chat partners: socket.id -> partner_socket.id
const bannedIds = new Set(); // Stores socket.ids of banned users
const activeGames = new Map(); // Stores active game instances: socket.id -> { type, gameInstance, partnerId, ...gameSpecificData }


// --- Matchmaking Algorithm ---
function findMatch(user) {
    console.log(`[Matchmaking] ${user.username} (${user.id}) initiated search for a match.`);

    // Remove current user from waiting list if they were there (e.g., rejoining after a reject or disconnect)
    waitingUsers = waitingUsers.filter(wUser => wUser.id !== user.id);

    // If no one else is waiting, add current user to queue
    if (waitingUsers.length === 0) {
        waitingUsers.push(user);
        console.log(`[Matchmaking] ${user.username} (${user.id}) added to empty waiting list.`);
        return null;
    }
    
    // Iterate through waiting users to find a potential match
    for (let i = 0; i < waitingUsers.length; i++) {
        const potentialMatch = waitingUsers[i];

        // Ensure potentialMatch is still connected and not already matched/pending
        if (!socketIdToUser.has(potentialMatch.id) || activePartners.has(potentialMatch.id) || isUserInPendingProposal(potentialMatch.id)) {
            console.log(`[Matchmaking] Cleaning up stale user ${potentialMatch.username || 'Unknown'} (${potentialMatch.id}) from waiting list.`);
            waitingUsers.splice(i, 1); // Remove stale user
            i--; // Adjust index due to removal
            continue;
        }

        // --- Preference-based matching logic (can be expanded) ---
        // Current logic: 20% chance for same gender, 80% for different.
        const isSameGender = user.gender === potentialMatch.gender;
        const random = Math.random();
        
        if ((isSameGender && random < 0.2) || (!isSameGender && random >= 0.2)) {
            waitingUsers.splice(i, 1); // Remove from waiting list
            console.log(`[Matchmaking] Found potential match: ${user.username} (${user.id}) with ${potentialMatch.username} (${potentialMatch.id}).`);
            return potentialMatch;
        }
    }
    
    // If no suitable match found based on preferences, add to queue
    waitingUsers.push(user);
    console.log(`[Matchmaking] ${user.username} (${user.id}) added to waiting list. No immediate match found.`);
    return null;
}

// Helper to check if a user is part of any pending proposal
function isUserInPendingProposal(userId) {
    for (const [key, p] of pendingProposals) {
        if (p.a === userId || p.b === userId) {
            return true;
        }
    }
    return false;
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
    
    socket.on('join', (userData) => {
        console.log(`[Join Request] User ${socket.id} attempting to join with data:`, userData);

        if (bannedIds.has(socket.id)) {
            socket.emit('age-restricted'); 
            console.warn(`[Join Denied] Banned user ${socket.id} attempted to join.`);
            return;
        }
        
        if (typeof userData.age !== 'number' || userData.age < 18) {
            socket.emit('age-restricted');
            console.warn(`[Join Denied] User ${socket.id} (age: ${userData.age}) rejected due to age restriction.`);
            return;
        }

        // Store/Update user profile
        const user = {
            id: socket.id,
            username: userData.username,
            gender: userData.gender,
            age: userData.age,
            about: userData.about,
            interests: userData.interests
        };
        socketIdToUser.set(socket.id, user);

        // --- Cleanup any previous states for this socket ---
        activePartners.delete(socket.id); 
        waitingUsers = waitingUsers.filter(wUser => wUser.id !== socket.id);
        
        for (const [key, p] of Array.from(pendingProposals.entries())) { 
            if (p.a === socket.id || p.b === socket.id) {
                pendingProposals.delete(key);
                const otherId = p.a === socket.id ? p.b : p.a;
                if (socketIdToUser.has(otherId)) {
                    io.to(otherId).emit('match-cancelled');
                    console.log(`[Join Cleanup] Pending proposal for ${otherId} cancelled due to ${socket.id} joining.`);
                }
            }
        }

        if (activeGames.has(socket.id)) {
            const gameData = activeGames.get(socket.id);
            if (gameData.partnerId && activeGames.has(gameData.partnerId)) {
                activeGames.delete(gameData.partnerId);
                io.to(gameData.partnerId).emit('game-ended', { reason: 'Partner started a new session.' });
                console.log(`[Join Cleanup] Notified partner ${gameData.partnerId} that ${socket.id} started a new session, ending game.`);
            }
            activeGames.delete(socket.id);
        }

        const partner = findMatch(user);

        if (partner) {
            const key = [socket.id, partner.id].sort().join('|');
            pendingProposals.set(key, { a: socket.id, b: partner.id, aAccepted: false, bAccepted: false });

            socket.emit('match-found', {
                id: partner.id, username: partner.username, gender: partner.gender, age: partner.age, about: partner.about, interests: partner.interests
            });
            io.to(partner.id).emit('match-found', {
                id: user.id, username: user.username, gender: user.gender, age: user.age, about: user.about, interests: user.interests
            });

            console.log(`[Join Matched] Proposed match between ${user.username} (${user.id}) and ${partner.username} (${partner.id}).`);
        } else {
            console.log(`[Join Waiting] ${user.username} (${user.id}) is waiting for a match.`);
        }
    });
    
    socket.on('message', (data) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== data.to) {
            console.warn(`[Message Denied] User ${socket.id} tried to message non-partner ${data.to}.`);
            return;
        }
        socket.to(partnerId).emit('message', {
            message: data.message,
            from: socket.id
        });
        console.log(`[Message Sent] ${socket.id} sent message to ${partnerId}.`);
    });
    
    socket.on('match-accept', ({ partnerId }) => {
        console.log(`[Match Accept] User ${socket.id} accepts match with ${partnerId}.`);
        const key = [socket.id, partnerId].sort().join('|');
        const pending = pendingProposals.get(key);
        
        if (!pending) {
            console.warn(`[Match Accept Denied] No pending proposal found for ${key}.`);
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

    socket.on('match-reject', ({ partnerId }) => {
        console.log(`[Match Reject] User ${socket.id} rejects match with ${partnerId}.`);
        const key = [socket.id, partnerId].sort().join('|');
        const pending = pendingProposals.get(key);
        
        if (!pending) {
            console.warn(`[Match Reject Denied] No pending proposal found for rejection from ${key}.`);
            return;
        }

        pendingProposals.delete(key);
        io.to(partnerId).emit('match-cancelled'); // Notify the counterpart

        const rejector = socketIdToUser.get(socket.id);
        const counterpart = socketIdToUser.get(partnerId);

        const tryRematch = (userToRequeue) => {
            if (!userToRequeue || activePartners.has(userToRequeue.id) || !socketIdToUser.has(userToRequeue.id) || isUserInPendingProposal(userToRequeue.id)) {
                console.log(`[Match Reject] Skipping requeue for ${userToRequeue?.username || 'Unknown'} (${userToRequeue?.id || 'N/A'}) - not eligible.`);
                return; 
            }
            waitingUsers = waitingUsers.filter(wUser => wUser.id !== userToRequeue.id); // Ensure not already in queue
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

    socket.on('typing', ({ to, isTyping }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) return;
        socket.to(partnerId).emit('typing', { from: socket.id, isTyping: Boolean(isTyping) });
    });

    // --- Generic Cleanup Function for Disconnected Sockets ---
    const cleanupUser = (disconnectedSocketId) => {
        const user = socketIdToUser.get(disconnectedSocketId);
        const username = user ? user.username : 'Unknown';
        console.log(`[Cleanup] Initiating cleanup for ${username} (${disconnectedSocketId}).`);

        waitingUsers = waitingUsers.filter(wUser => wUser.id !== disconnectedSocketId);
        
        for (const [key, p] of Array.from(pendingProposals.entries())) {
            if (p.a === disconnectedSocketId || p.b === disconnectedSocketId) {
                pendingProposals.delete(key);
                const otherId = p.a === disconnectedSocketId ? p.b : p.a;
                if (socketIdToUser.has(otherId)) {
                    io.to(otherId).emit('match-cancelled');
                    console.log(`[Cleanup] Pending proposal for ${otherId} cancelled due to ${disconnectedSocketId} disconnect.`);
                }
            }
        }

        const partnerId = activePartners.get(disconnectedSocketId);
        if (partnerId) {
            activePartners.delete(disconnectedSocketId);
            activePartners.delete(partnerId);
            if (socketIdToUser.has(partnerId)) {
                io.to(partnerId).emit('partner-disconnected');
                console.log(`[Cleanup] Active partner ${partnerId} notified of ${disconnectedSocketId} disconnect.`);
            }
        }

        if (activeGames.has(disconnectedSocketId)) {
            const game = activeGames.get(disconnectedSocketId);
            activeGames.delete(disconnectedSocketId);
            if (game.partnerId && activeGames.has(game.partnerId)) {
                activeGames.delete(game.partnerId); 
                io.to(game.partnerId).emit('game-ended', { reason: 'Partner disconnected' }); 
                console.log(`[Cleanup] Active game with ${game.partnerId} ended due to ${disconnectedSocketId} disconnect.`);
            }
        }

        socketIdToUser.delete(disconnectedSocketId);
        console.log(`[Cleanup] Finished cleanup for ${username} (${disconnectedSocketId}).`);
    };

    socket.on('disconnect-me', () => {
        console.log(`[User Action] User ${socket.id} explicitly requested disconnect.`);
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
            console.warn(`[Follow Denied] Invalid follow request from ${socket.id} to ${userId}.`);
            return;
        }
        io.to(userId).emit('followed', { by: socket.id, byName: follower.username });
        console.log(`[Follow] ${follower.username} (${socket.id}) followed ${userId}.`);
    });

    socket.on('unfollow', ({ userId }) => {
        const follower = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!follower || !userId || partnerId !== userId) {
            console.warn(`[Unfollow Denied] Invalid unfollow request from ${socket.id} to ${userId}.`);
            return;
        }
        io.to(userId).emit('unfollowed', { by: socket.id, byName: follower.username });
        console.log(`[Unfollow] ${follower.username} (${socket.id}) unfollowed ${userId}.`);
    });

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
        if (activeGames.has(inviterSocket)) {
            const gameData = activeGames.get(inviterSocket);
            if (gameData.partnerId === socket.id && gameData.type === type) {
                activeGames.delete(inviterSocket);
                activeGames.delete(socket.id); 
                console.log(`[Game Cleanup] Cleaned up ${type} game state after rejection.`);
            }
        }
    });


    // --- Chess Game Handlers ---
    socket.on('chess-invite', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[Chess Invite Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        if (activeGames.has(socket.id) || activeGames.has(to)) {
             socket.emit('game-invite-failed', { message: "You or your partner are already in a game or have a pending invite." });
             console.warn(`[Chess Invite Denied] ${socket.id} or ${to} already in a game/pending.`);
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
            console.warn(`[Chess Accept Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameDataInviter = activeGames.get(to);
        const gameDataAcceptor = activeGames.get(socket.id);
        
        if (!gameDataInviter || gameDataInviter.type !== 'chess' || !gameDataAcceptor || gameDataAcceptor.type !== 'chess' || gameDataInviter.game !== gameDataAcceptor.game) {
            console.warn(`[Chess Accept Denied] Invalid game data for ${socket.id} and ${to}.`);
            return;
        }
        
        io.to(to).emit('chess-start', { color: gameDataInviter.color, fen: gameDataInviter.game.fen() });
        io.to(socket.id).emit('chess-start', { color: gameDataAcceptor.color, fen: gameDataAcceptor.game.fen() });
        console.log(`[Chess Start] Game started between ${to} (white) and ${socket.id} (black).`);
    });

    socket.on('chess-move', ({ to, move }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Move Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);

        if (!gameData || gameData.type !== 'chess' || !partnerGameData) {
            console.warn(`[Chess Move Denied] No valid game data for ${socket.id}.`);
            return;
        }
        
        try {
            const currentTurnColor = gameData.game.turn() === 'w' ? 'white' : 'black';
            if (currentTurnColor !== gameData.color) {
                console.warn(`[Chess Move Denied] Not ${socket.id}'s turn. Current turn: ${currentTurnColor}.`);
                return;
            }

            const result = gameData.game.move(move);
            if (result) {
                gameData.drawOfferBy = null; 
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
                    io.to(to).emit('chess-game-over', { outcome: outcome === activeGames.get(to).color ? 'win' : (outcome === 'draw' ? 'draw' : 'lose') });
                    
                    activeGames.delete(socket.id);
                    activeGames.delete(to);
                }
            } else {
                console.warn(`[Chess Move Denied] Invalid move attempted by ${socket.id}:`, move);
            }
        } catch (e) {
            console.error(`[Chess Move Error] Error processing move from ${socket.id}:`, e);
        }
    });

    socket.on('chess-resign', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Resign Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        io.to(to).emit('chess-resigned');
        io.to(socket.id).emit('chess-resigned');
        console.log(`[Chess Resign] ${socket.id} resigned from game against ${to}.`);
        
        activeGames.delete(socket.id);
        activeGames.delete(to);
    });

    // --- Chess Draw Offer Handlers ---
    socket.on('chess-offer-draw', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[Chess Draw Offer Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }

        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);
        if (!gameData || gameData.type !== 'chess' || gameData.game.game_over() || !partnerGameData) {
            console.warn(`[Chess Draw Offer Denied] No valid chess game or game over for ${socket.id}.`);
            return;
        }

        if (gameData.drawOfferBy) { 
            console.log(`[Chess Draw Offer] ${socket.id} already has a pending draw offer.`);
            return;
        }
        if (partnerGameData.drawOfferBy === socket.id) {
            console.log(`[Chess Draw Offer] ${to} already offered draw to ${socket.id}.`);
            return;
        }

        gameData.drawOfferBy = socket.id; 
        partnerGameData.drawOfferBy = socket.id;

        io.to(to).emit('chess-draw-offer', { from: socket.id, byName: user.username });
        console.log(`[Chess Draw Offer] ${user.username} (${socket.id}) offered a draw to ${to}.`);
    });

    socket.on('chess-accept-draw', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Draw Accept Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }

        const gameData = activeGames.get(socket.id); 
        const inviterGameData = activeGames.get(to); 

        if (!gameData || gameData.type !== 'chess' || !inviterGameData || inviterGameData.type !== 'chess') {
            console.warn(`[Chess Draw Accept Denied] No valid chess game for ${socket.id} and ${to}.`);
            return;
        }
        
        if (gameData.drawOfferBy === to) { 
            io.to(socket.id).emit('chess-game-over', { outcome: 'draw' });
            io.to(to).emit('chess-game-over', { outcome: 'draw' });
            console.log(`[Chess End] Chess game between ${socket.id} and ${to} ended in a draw by agreement.`);
            
            activeGames.delete(socket.id);
            activeGames.delete(to);
        } else {
            console.warn(`[Chess Draw Accept Denied] No pending offer from ${to} to ${socket.id}.`);
        }
    });

    socket.on('chess-reject-draw', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[Chess Draw Reject Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }

        const gameData = activeGames.get(socket.id); 
        const inviterGameData = activeGames.get(to); 

        if (!gameData || gameData.type !== 'chess' || !inviterGameData || inviterGameData.type !== 'chess') {
            console.warn(`[Chess Draw Reject Denied] No valid chess game for ${socket.id} and ${to}.`);
            return;
        }

        if (gameData.drawOfferBy === to) { 
            gameData.drawOfferBy = null; 
            inviterGameData.drawOfferBy = null; 
            io.to(to).emit('chess-draw-rejected', { from: socket.id, byName: socketIdToUser.get(socket.id)?.username || 'Opponent' });
            console.log(`[Chess Draw Reject] ${socket.id} rejected draw offer from ${to}.`);
        } else {
            console.warn(`[Chess Draw Reject Denied] No pending offer from ${to} to ${socket.id}.`);
        }
    });


    // --- Tic Tac Toe Handlers ---
    socket.on('ttt-invite', ({ to }) => {
        const user = socketIdToUser.get(socket.id);
        const partnerId = activePartners.get(socket.id);
        if (!user || !to || partnerId !== to) {
            console.warn(`[TTT Invite Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        if (activeGames.has(socket.id) || activeGames.has(to)) {
             socket.emit('game-invite-failed', { message: "You or your partner are already in a game or have a pending invite." });
             console.warn(`[TTT Invite Denied] ${socket.id} or ${to} already in a game/pending.`);
             return;
        }

        const board = ['', '', '', '', '', '', '', '', '']; 
        const initialTurn = 'X'; 
        
        activeGames.set(socket.id, {
            type: 'ttt',
            board: board, 
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
            console.warn(`[TTT Accept Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameDataInviter = activeGames.get(to);
        const gameDataAcceptor = activeGames.get(socket.id);
        
        if (!gameDataInviter || gameDataInviter.type !== 'ttt' || !gameDataAcceptor || gameDataAcceptor.type !== 'ttt' || gameDataInviter.board !== gameDataAcceptor.board) {
            console.warn(`[TTT Accept Denied] Invalid game data for ${socket.id} and ${to}.`);
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
            console.warn(`[TTT Move Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);

        if (!gameData || gameData.type !== 'ttt' || !partnerGameData) {
            console.warn(`[TTT Move Denied] No valid game data for ${socket.id}.`);
            return;
        }
        
        if (gameData.board[idx] !== '' || idx < 0 || idx > 8 || gameData.currentTurn !== gameData.mark) {
            console.warn(`[TTT Move Denied] Invalid move by ${socket.id}: idx=${idx}, currentTurn=${gameData.currentTurn}, playerMark=${gameData.mark}.`);
            return;
        }
        
        gameData.board[idx] = gameData.mark;
        console.log(`[TTT Move] ${socket.id} (mark: ${gameData.mark}) moved to idx ${idx}.`);
        
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
            gameData.currentTurn = (gameData.mark === 'X' ? 'O' : 'X');
            partnerGameData.currentTurn = gameData.currentTurn;

            io.to(to).emit('ttt-move', { idx, mark: gameData.mark });
            
            io.to(socket.id).emit('ttt-update-turn', { currentTurn: gameData.currentTurn, yourMark: gameData.mark });
            io.to(to).emit('ttt-update-turn', { currentTurn: partnerGameData.currentTurn, yourMark: partnerGameData.mark });
        }
    });

    socket.on('ttt-reset', ({ to }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[TTT Reset Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        const partnerGameData = activeGames.get(to);

        if (!gameData || gameData.type !== 'ttt' || !partnerGameData) {
            console.warn(`[TTT Reset Denied] No valid game data for ${socket.id}.`);
            return;
        }
        
        const newBoard = ['', '', '', '', '', '', '', '', ''];
        gameData.board.splice(0, gameData.board.length, ...newBoard); 
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
            console.warn(`[RPS Invite Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        if (activeGames.has(socket.id) || activeGames.has(to)) {
             socket.emit('game-invite-failed', { message: "You or your partner are already in a game or have a pending invite." });
             console.warn(`[RPS Invite Denied] ${socket.id} or ${to} already in a game/pending.`);
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
            console.warn(`[RPS Accept Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameDataInviter = activeGames.get(to);
        const gameDataAcceptor = activeGames.get(socket.id);
        
        if (!gameDataInviter || gameDataInviter.type !== 'rps' || !gameDataAcceptor || gameDataAcceptor.type !== 'rps') {
            console.warn(`[RPS Accept Denied] Invalid game data for ${socket.id} and ${to}.`);
            return;
        }
        
        io.to(to).emit('rps-start');
        io.to(socket.id).emit('rps-start');
        console.log(`[RPS Start] Game started between ${to} and ${socket.id}.`);
    });

    socket.on('rps-move', ({ to, move }) => {
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== to) {
            console.warn(`[RPS Move Denied] ${socket.id} not partnered with ${to}.`);
            return;
        }
        
        const gameData = activeGames.get(socket.id);
        if (!gameData || gameData.type !== 'rps' || gameData.move !== null) {
            console.warn(`[RPS Move Denied] ${socket.id} already moved or not in game.`);
            return;
        }
        
        gameData.move = move;
        console.log(`[RPS Move] ${socket.id} chose ${move}.`);
        io.to(to).emit('rps-opponent-moved'); 
        
        const partnerGameData = activeGames.get(to);
        if (partnerGameData && partnerGameData.move) {
            const winner = determineRPSWinner(gameData.move, partnerGameData.move);
            
            let outcomeForSender, outcomeForPartner;
            if (winner === 'draw') {
                outcomeForSender = outcomeForPartner = 'draw';
            } else if (winner === 'player1') { 
                outcomeForSender = 'win';
                outcomeForPartner = 'lose';
            } else { 
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
    console.log(`[Admin Connect] Admin connected: ${adminSocket.id}`);

    const listPairs = () => {
        const result = [];
        const seenPairs = new Set();
        for (const [id1, id2] of activePartners.entries()) {
            const sortedIds = [id1, id2].sort().join('|');
            if (!seenPairs.has(sortedIds)) {
                const user1 = socketIdToUser.get(id1) || { username: `Unknown (${id1})` };
                const user2 = socketIdToUser.get(id2) || { username: `Unknown (${id2})` };
                result.push({ id1, id2, name1: user1.username, name2: user2.username });
                seenPairs.add(sortedIds);
            }
        }
        adminSocket.emit('admin:pairs', result);
    };

    const listBanned = () => {
        const bannedUsers = Array.from(bannedIds).map(id => {
            const user = socketIdToUser.get(id);
            return user ? { id, username: user.username } : { id, username: 'Unknown (disconnected)' };
        });
        adminSocket.emit('admin:banned', bannedUsers);
    };

    adminSocket.on('admin:list', () => {
        listPairs();
        listBanned();
        console.log(`[Admin Action] Admin ${adminSocket.id} requested lists.`);
    });

    adminSocket.on('admin:terminate', ({ id1, id2 }) => {
        if (!id1 || !id2) {
            console.warn(`[Admin Action] Invalid terminate request from ${adminSocket.id}.`);
            return;
        }
        if (activePartners.get(id1) === id2 && activePartners.get(id2) === id1) {
            console.log(`[Admin Action] Admin ${adminSocket.id} terminated chat between ${id1} and ${id2}.`);
            cleanupUser(id1); 
            cleanupUser(id2);
            io.to(id1).emit('partner-disconnected');
            io.to(id2).emit('partner-disconnected');
        } else {
            console.warn(`[Admin Action] Terminate failed: ${id1} and ${id2} are not active partners.`);
        }
        listPairs();
    });

    adminSocket.on('admin:ban', ({ id }) => {
        if (!id) {
            console.warn(`[Admin Action] Invalid ban request from ${adminSocket.id}.`);
            return;
        }
        if (!bannedIds.has(id)) {
            bannedIds.add(id);
            console.log(`[Admin Action] Admin ${adminSocket.id} banned user: ${id}.`);
            io.to(id).disconnectSockets(true);
            cleanupUser(id);
        }
        listBanned();
    });
    
    adminSocket.on('admin:unban', ({ id }) => {
        if (!id) {
            console.warn(`[Admin Action] Invalid unban request from ${adminSocket.id}.`);
            return;
        }
        if (bannedIds.delete(id)) {
            console.log(`[Admin Action] Admin ${adminSocket.id} unbanned user: ${id}.`);
        }
        listBanned();
    });
    
    adminSocket.on('admin:stats', () => {
        const stats = {
            waitingUsers: waitingUsers.length,
            activePairs: new Set(Array.from(activePartners.values())).size, 
            pendingProposals: pendingProposals.size,
            activeGames: new Set(Array.from(activeGames.values()).map(game => game.game || game.board || game.partnerId)).size,
            bannedUsers: bannedIds.size,
            connectedSockets: io.of('/').sockets.size 
        };
        adminSocket.emit('admin:stats', stats);
    });

    const adminInterval = setInterval(() => {
        listPairs();
        listBanned();
        adminSocket.emit('admin:stats', {
            waitingUsers: waitingUsers.length,
            activePairs: new Set(Array.from(activePartners.values())).size,
            pendingProposals: pendingProposals.size,
            activeGames: new Set(Array.from(activeGames.values()).map(game => game.game || game.board || game.partnerId)).size,
            bannedUsers: bannedIds.size,
            connectedSockets: io.of('/').sockets.size
        });
    }, 5000);

    adminSocket.on('disconnect', () => {
        console.log(`[Admin Disconnect] Admin disconnected: ${adminSocket.id}.`);
        clearInterval(adminInterval);
    });
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
