import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sharp from 'sharp';
import fs from 'fs/promises';
import { SocialRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 🚀 INTROVERT - Next-Generation Anonymous Social Platform
class IntrovertServer {
    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: function (origin, callback) {
                    // Allow requests with no origin (file:// protocol)
                    if (!origin) return callback(null, true);
                    // Allow any origin
                    return callback(null, true);
                },
                methods: ["GET", "POST"],
                credentials: true,
                allowedHeaders: ["Content-Type", "Authorization"]
            },
            transports: ['websocket', 'polling'],
            allowEIO3: true
        });

        this.PORT = process.env.PORT || 3000;
        this.JWT_SECRET = process.env.JWT_SECRET || 'introvert-secret-key';

        // Data stores (In production, use Redis/MongoDB)
        this.users = new Map();
        this.activeConnections = new Map();
        this.chatRooms = new Map();
        this.messages = new Map();
        this.watchParties = new Map();
        this.canvasRooms = new Map();
        this.aiSuggestions = new Map();
        
        // New advanced features data stores
        this.posts = new Map();
        this.comments = new Map();
        this.likes = new Map();
        this.follows = new Map();
        this.notifications = new Map();
        this.badges = new Map();
        this.faceMatches = new Map();
        this.searchHistory = new Map();
        this.randomMatchQueue = new Map();

        this.initializeUploadConfig();
        this.socialRoutes = new SocialRoutes(this);
        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeSocketHandlers();
        this.startServer();
    }

    // 📁 Upload Configuration
    async initializeUploadConfig() {
        // Create uploads directories
        try {
            await fs.mkdir(join(__dirname, 'uploads'), { recursive: true });
            await fs.mkdir(join(__dirname, 'uploads/posts'), { recursive: true });
            await fs.mkdir(join(__dirname, 'uploads/profiles'), { recursive: true });
        } catch (error) {
            this.logWarning('Upload directories already exist or creation failed');
        }

        // Configure multer for file uploads
        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadPath = file.fieldname === 'profilePicture' ? 
                    join(__dirname, 'uploads/profiles') : 
                    join(__dirname, 'uploads/posts');
                cb(null, uploadPath);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
            }
        });

        this.upload = multer({
            storage: storage,
            limits: {
                fileSize: 10 * 1024 * 1024 // 10MB limit
            },
            fileFilter: (req, file, cb) => {
                if (file.mimetype.startsWith('image/')) {
                    cb(null, true);
                } else {
                    cb(new Error('Only image files are allowed!'), false);
                }
            }
        });

        this.logSuccess('📁 Upload configuration initialized');
    }

    // 🛡️ Security & Middleware Setup
    initializeMiddleware() {
        // Security headers - Relaxed for file:// protocol access
        this.app.use(helmet({
            contentSecurityPolicy: false, // Disable CSP to allow file:// protocol
            crossOriginEmbedderPolicy: false,
            crossOriginResourcePolicy: { policy: "cross-origin" }
        }));

        // CORS configuration - Allow file:// protocol and all origins
        this.app.use(cors({
            origin: function (origin, callback) {
                // Allow requests with no origin (like mobile apps, file://, or curl requests)
                if (!origin) return callback(null, true);
                // Allow any origin
                return callback(null, true);
            },
            credentials: true,
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
            exposedHeaders: ["Set-Cookie"]
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100,
            message: { error: 'Too many requests, please try again later.' }
        });

        const authLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 5,
            message: { error: 'Too many authentication attempts.' }
        });

        this.app.use(compression());
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use(cookieParser());
        this.app.use(express.static(__dirname));
        this.app.use('/uploads', express.static(join(__dirname, 'uploads')));
        this.app.use('/api/auth', authLimiter);
        this.app.use('/api', limiter);

        // Additional CORS headers for file:// protocol
        this.app.use((req, res, next) => {
            // Set CORS headers explicitly
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Access-Control-Expose-Headers', 'Set-Cookie');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
                return;
            }

            next();
        });

        // Request logging middleware
        this.app.use((req, res, next) => {
            const start = Date.now();

            res.on('finish', () => {
                const duration = Date.now() - start;
                const statusColor = res.statusCode >= 400 ? 'ERROR' :
                    res.statusCode >= 300 ? 'WARNING' : 'SUCCESS';

                this.log(`${req.method} ${req.originalUrl}`, {
                    method: req.method,
                    url: req.originalUrl,
                    status: res.statusCode,
                    duration: `${duration}ms`,
                    userAgent: req.get('User-Agent'),
                    origin: req.get('Origin') || 'null',
                    ip: req.ip || req.connection.remoteAddress
                }, statusColor);
            });

            next();
        });

        this.logSuccess('🛡️ Security middleware initialized');
    }

    // 🌐 API Routes
    initializeRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: '2.0.0',
                features: ['AI-Powered', 'Real-time', 'Anonymous', 'Secure'],
                stats: {
                    users: this.users.size,
                    activeConnections: this.activeConnections.size,
                    chatRooms: this.chatRooms.size,
                    messages: this.messages.size
                }
            });
        });

        // Serve main app
        this.app.get('/', (req, res) => {
            res.sendFile(join(__dirname, 'index.html'));
        });

        // Authentication routes
        this.app.post('/api/auth/register', this.handleRegister.bind(this));
        this.app.post('/api/auth/login', this.handleLogin.bind(this));
        this.app.post('/api/auth/logout', this.handleLogout.bind(this));

        // User routes
        this.app.get('/api/user/profile', this.authenticateToken, this.getUserProfile.bind(this));
        this.app.put('/api/user/profile', this.authenticateToken, this.updateUserProfile.bind(this));

        // Social features
        this.app.post('/api/social/find-match', this.authenticateToken, this.findRandomMatch.bind(this));
        this.app.post('/api/social/find-match-enhanced', this.authenticateToken, this.socialRoutes.findRandomMatchEnhanced.bind(this.socialRoutes));
        this.app.post('/api/social/create-room', this.authenticateToken, this.createChatRoom.bind(this));

        // AI features
        this.app.post('/api/ai/smart-replies', this.authenticateToken, this.generateSmartReplies.bind(this));
        this.app.post('/api/ai/translate', this.authenticateToken, this.translateMessage.bind(this));
        this.app.post('/api/ai/moderate', this.authenticateToken, this.moderateContent.bind(this));

        // Watch party features
        this.app.post('/api/party/create', this.authenticateToken, this.createWatchParty.bind(this));
        this.app.post('/api/party/:id/join', this.authenticateToken, this.joinWatchParty.bind(this));

        // Posts and Social Features
        this.app.post('/api/posts/create', this.authenticateToken, this.socialRoutes.createPost.bind(this.socialRoutes));
        this.app.get('/api/posts/feed', this.authenticateToken, this.socialRoutes.getFeed.bind(this.socialRoutes));
        this.app.get('/api/posts/:id', this.authenticateToken, this.socialRoutes.getPost.bind(this.socialRoutes));
        this.app.post('/api/posts/:id/like', this.authenticateToken, this.socialRoutes.likePost.bind(this.socialRoutes));
        this.app.post('/api/posts/:id/comment', this.authenticateToken, this.socialRoutes.commentPost.bind(this.socialRoutes));
        this.app.delete('/api/posts/:id', this.authenticateToken, this.socialRoutes.deletePost.bind(this.socialRoutes));

        // Follow System
        this.app.post('/api/follow/:userId', this.authenticateToken, this.socialRoutes.followUser.bind(this.socialRoutes));
        this.app.post('/api/unfollow/:userId', this.authenticateToken, this.socialRoutes.unfollowUser.bind(this.socialRoutes));
        this.app.get('/api/followers/:userId', this.authenticateToken, this.socialRoutes.getFollowers.bind(this.socialRoutes));
        this.app.get('/api/following/:userId', this.authenticateToken, this.socialRoutes.getFollowing.bind(this.socialRoutes));
        this.app.get('/api/follow/requests', this.authenticateToken, this.socialRoutes.getFollowRequests.bind(this.socialRoutes));
        this.app.post('/api/follow/accept/:userId', this.authenticateToken, this.socialRoutes.acceptFollowRequest.bind(this.socialRoutes));
        this.app.post('/api/follow/reject/:userId', this.authenticateToken, this.socialRoutes.rejectFollowRequest.bind(this.socialRoutes));

        // Search Features
        this.app.get('/api/search/users', this.authenticateToken, this.socialRoutes.searchUsers.bind(this.socialRoutes));
        this.app.post('/api/search/face', this.authenticateToken, this.socialRoutes.searchByFace.bind(this.socialRoutes));
        this.app.get('/api/search/history', this.authenticateToken, this.socialRoutes.getSearchHistory.bind(this.socialRoutes));

        // Notifications
        this.app.get('/api/notifications', this.authenticateToken, this.socialRoutes.getNotifications.bind(this.socialRoutes));
        this.app.put('/api/notifications/mark-read', this.authenticateToken, this.socialRoutes.markAllNotificationsRead.bind(this.socialRoutes));
        this.app.post('/api/notifications/:id/read', this.authenticateToken, this.socialRoutes.markNotificationRead.bind(this.socialRoutes));
        this.app.delete('/api/notifications/:id', this.authenticateToken, this.socialRoutes.deleteNotification.bind(this.socialRoutes));

        // Profile Management
        this.app.post('/api/profile/upload-picture', this.authenticateToken, this.socialRoutes.uploadProfilePicture.bind(this.socialRoutes));
        this.app.get('/api/profile/:userId', this.authenticateToken, this.socialRoutes.getProfile.bind(this.socialRoutes));
        this.app.put('/api/profile/edit', this.authenticateToken, this.socialRoutes.editProfile.bind(this.socialRoutes));

        // Badge System
        this.app.get('/api/badges/:userId', this.authenticateToken, this.socialRoutes.getUserBadges.bind(this.socialRoutes));

        this.logSuccess('🌐 API routes initialized');
    }

    // 🔐 Authentication middleware
    authenticateToken(req, res, next) {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        try {
            const decoded = jwt.verify(token, this.JWT_SECRET);
            req.user = this.users.get(decoded.userId);
            if (!req.user) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            next();
        } catch (error) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
    }

    // 👤 Authentication handlers
    async handleRegister(req, res) {
        try {
            const { username, email, password, age, gender, interests } = req.body;

            // Validation
            if (!username || !email || !password || !age || !gender) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            if (age < 18) {
                return res.status(400).json({ error: 'Must be 18 or older' });
            }

            // Check if user exists
            for (const user of this.users.values()) {
                if (user.username === username || user.email === email) {
                    return res.status(409).json({ error: 'User already exists' });
                }
            }

            // Create user
            const userId = uuidv4();
            const hashedPassword = await bcrypt.hash(password, 12);

            const user = {
                id: userId,
                username: this.sanitize(username),
                email: email.toLowerCase(),
                password: hashedPassword,
                age: parseInt(age),
                gender,
                interests: interests || [],
                profilePic: null,
                bio: '',
                isOnline: false,
                lastSeen: new Date(),
                createdAt: new Date(),
                preferences: {
                    allowRandomMatch: true,
                    showOnlineStatus: true,
                    matchGender: 'both',
                    notifications: true
                },
                stats: {
                    totalChats: 0,
                    totalMessages: 0,
                    friendsCount: 0,
                    postsCount: 0,
                    followersCount: 0,
                    followingCount: 0,
                    likesReceived: 0,
                    randomMatchFollows: 0
                },
                badges: [],
                profilePicture: null,
                posts: [],
                followers: [],
                following: [],
                notifications: [],
                faceEmbedding: null, // For face detection matching
                searchable: true
            };

            this.users.set(userId, user);

            // Generate JWT
            const token = jwt.sign({ userId }, this.JWT_SECRET, { expiresIn: '30d' });

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });

            this.logSuccess(`✅ User registered: ${username}`, {
                userId: user.id,
                email: user.email,
                age: user.age,
                gender: user.gender
            });
            res.status(201).json({
                success: true,
                user: this.sanitizeUser(user),
                token
            });

        } catch (error) {
            this.logError(`❌ Registration error: ${error.message}`, {
                username: req.body.username,
                email: req.body.email,
                error: error.stack
            });
            res.status(500).json({ error: 'Registration failed' });
        }
    }

    async handleLogin(req, res) {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({ error: 'Username and password required' });
            }

            // Find user
            let user = null;
            for (const u of this.users.values()) {
                if (u.username === username || u.email === username) {
                    user = u;
                    break;
                }
            }

            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Update user status
            user.isOnline = true;
            user.lastSeen = new Date();

            // Generate JWT
            const token = jwt.sign({ userId: user.id }, this.JWT_SECRET, { expiresIn: '30d' });

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 30 * 24 * 60 * 60 * 1000
            });

            this.logSuccess(`✅ User logged in: ${user.username}`, {
                userId: user.id,
                lastSeen: user.lastSeen,
                isOnline: user.isOnline
            });
            res.json({
                success: true,
                user: this.sanitizeUser(user),
                token
            });

        } catch (error) {
            this.logError(`❌ Login error: ${error.message}`, {
                username: req.body.username,
                error: error.stack
            });
            res.status(500).json({ error: 'Login failed' });
        }
    }

    handleLogout(req, res) {
        res.clearCookie('token');
        res.json({ success: true, message: 'Logged out successfully' });
    }

    // 👤 User management
    getUserProfile(req, res) {
        res.json({
            success: true,
            user: this.sanitizeUser(req.user)
        });
    }

    updateUserProfile(req, res) {
        const { bio, interests, preferences } = req.body;
        const user = req.user;

        if (bio !== undefined) user.bio = this.sanitize(bio);
        if (interests !== undefined) user.interests = interests;
        if (preferences !== undefined) {
            user.preferences = { ...user.preferences, ...preferences };
        }

        res.json({
            success: true,
            user: this.sanitizeUser(user)
        });
    }

    // 🏠 Chat room creation
    createChatRoom(req, res) {
        const { roomName, isPrivate = false, maxParticipants = 10 } = req.body;
        const user = req.user;

        if (!roomName || roomName.trim().length === 0) {
            return res.status(400).json({ error: 'Room name is required' });
        }

        const roomId = uuidv4();
        const room = {
            id: roomId,
            name: this.sanitize(roomName.trim()),
            type: 'custom',
            hostId: user.id,
            participants: [user.id],
            messages: [],
            isPrivate,
            maxParticipants,
            createdAt: new Date(),
            isActive: true
        };

        this.chatRooms.set(roomId, room);

        this.logSuccess(`🏠 Chat room created: ${room.name} by ${user.username}`, {
            roomId: room.id,
            hostId: user.id,
            isPrivate: room.isPrivate,
            maxParticipants: room.maxParticipants
        });

        res.json({
            success: true,
            room: {
                id: room.id,
                name: room.name,
                type: room.type,
                hostId: room.hostId,
                participantCount: room.participants.length,
                maxParticipants: room.maxParticipants,
                isPrivate: room.isPrivate,
                createdAt: room.createdAt
            },
            roomId
        });
    }

    // 🎲 Random matching
    findRandomMatch(req, res) {
        const currentUser = req.user;
        const { genderPreference = 'both' } = req.body;

        const potentialMatches = Array.from(this.users.values()).filter(user => {
            if (user.id === currentUser.id) return false;
            if (!user.isOnline || !user.preferences.allowRandomMatch) return false;

            if (genderPreference !== 'both' && user.gender !== genderPreference) return false;
            if (currentUser.preferences.matchGender !== 'both' &&
                currentUser.gender === user.gender) return false;

            return true;
        });

        if (potentialMatches.length === 0) {
            return res.json({ success: false, message: 'No matches available' });
        }

        const match = potentialMatches[Math.floor(Math.random() * potentialMatches.length)];
        const roomId = uuidv4();

        this.chatRooms.set(roomId, {
            id: roomId,
            type: 'random',
            participants: [currentUser.id, match.id],
            messages: [],
            createdAt: new Date(),
            isActive: true
        });

        this.logSuccess(`🎲 Random match created: ${currentUser.username} ↔ ${match.username}`, {
            roomId,
            user1: currentUser.id,
            user2: match.id,
            genderPreference
        });

        res.json({
            success: true,
            match: this.sanitizeUser(match),
            roomId
        });
    }

    // 🤖 AI Features
    generateSmartReplies(req, res) {
        const { message } = req.body;

        const replies = [
            "That's really interesting! Tell me more about it.",
            "I can totally relate to that feeling.",
            "Thanks for sharing that with me! 😊",
            "What made you think about that?",
            "That sounds amazing! How did it go?"
        ];

        // Simple AI logic based on message content
        const contextualReplies = [];
        if (message.toLowerCase().includes('happy') || message.toLowerCase().includes('good')) {
            contextualReplies.push("That's wonderful to hear! 🎉");
        }
        if (message.toLowerCase().includes('sad') || message.toLowerCase().includes('bad')) {
            contextualReplies.push("I'm sorry to hear that. Want to talk about it?");
        }

        const finalReplies = [...contextualReplies, ...replies].slice(0, 3);

        res.json({
            success: true,
            replies: finalReplies
        });
    }

    translateMessage(req, res) {
        const { text, targetLanguage } = req.body;

        // Simple translation simulation
        const translations = {
            'es': text.replace(/hello/gi, 'hola').replace(/how are you/gi, 'cómo estás'),
            'fr': text.replace(/hello/gi, 'bonjour').replace(/how are you/gi, 'comment allez-vous'),
            'de': text.replace(/hello/gi, 'hallo').replace(/how are you/gi, 'wie geht es dir')
        };

        res.json({
            success: true,
            originalText: text,
            translatedText: translations[targetLanguage] || text,
            targetLanguage
        });
    }

    moderateContent(req, res) {
        const { content } = req.body;

        const inappropriateWords = ['spam', 'abuse', 'hate', 'toxic'];
        const flags = inappropriateWords.filter(word =>
            content.toLowerCase().includes(word)
        );

        res.json({
            success: true,
            isAppropriate: flags.length === 0,
            flags,
            confidence: flags.length === 0 ? 0.95 : 0.8
        });
    }

    // 🎬 Watch Party Features
    createWatchParty(req, res) {
        const { videoUrl, title } = req.body;
        const user = req.user;

        const partyId = uuidv4();
        const party = {
            id: partyId,
            hostId: user.id,
            title: this.sanitize(title),
            videoUrl,
            participants: [user.id],
            currentTime: 0,
            isPlaying: false,
            createdAt: new Date()
        };

        this.watchParties.set(partyId, party);

        this.logSuccess(`🎬 Watch party created: ${title} by ${user.username}`, {
            partyId,
            hostId: user.id,
            videoUrl
        });

        res.json({
            success: true,
            party
        });
    }

    joinWatchParty(req, res) {
        const { id } = req.params;
        const user = req.user;

        const party = this.watchParties.get(id);
        if (!party) {
            return res.status(404).json({ error: 'Watch party not found' });
        }

        if (!party.participants.includes(user.id)) {
            party.participants.push(user.id);
        }

        res.json({
            success: true,
            party
        });
    }

    // 🔌 Socket.IO Handlers
    initializeSocketHandlers() {
        this.io.on('connection', (socket) => {
            this.log(`🔌 Socket connected: ${socket.id}`, {
                socketId: socket.id,
                remoteAddress: socket.handshake.address,
                userAgent: socket.handshake.headers['user-agent']
            });

            socket.on('authenticate', (token) => {
                try {
                    const decoded = jwt.verify(token, this.JWT_SECRET);
                    const user = this.users.get(decoded.userId);
                    if (user) {
                        socket.userId = user.id;
                        socket.user = user;
                        this.activeConnections.set(socket.id, user.id);
                        user.isOnline = true;

                        socket.join(`user_${user.id}`);
                        this.logSuccess(`✅ Socket authenticated: ${user.username}`, {
                            socketId: socket.id,
                            userId: user.id
                        });
                    }
                } catch (error) {
                    socket.emit('auth_error', { message: 'Invalid token' });
                }
            });

            socket.on('join_room', (roomId) => {
                socket.join(roomId);
                this.log(`📱 User joined room: ${roomId}`, {
                    socketId: socket.id,
                    userId: socket.userId,
                    username: socket.user?.username,
                    roomId
                });
            });

            socket.on('send_message', (data) => {
                this.handleSocketMessage(socket, data);
            });

            socket.on('typing', (data) => {
                socket.to(data.roomId).emit('user_typing', {
                    userId: socket.userId,
                    username: socket.user?.username
                });
            });

            socket.on('stop_typing', (data) => {
                socket.to(data.roomId).emit('user_stop_typing', {
                    userId: socket.userId
                });
            });

            socket.on('video_sync', (data) => {
                socket.to(`party_${data.partyId}`).emit('sync_video', {
                    currentTime: data.currentTime,
                    isPlaying: data.isPlaying,
                    syncedBy: socket.userId
                });
            });

            socket.on('canvas_draw', (data) => {
                socket.to(`canvas_${data.canvasId}`).emit('canvas_stroke', {
                    stroke: data.stroke,
                    userId: socket.userId
                });
            });

            socket.on('disconnect', () => {
                if (socket.userId) {
                    const user = this.users.get(socket.userId);
                    if (user) {
                        user.isOnline = false;
                        user.lastSeen = new Date();
                    }
                    this.activeConnections.delete(socket.id);
                }
                this.logWarning(`🔌 Socket disconnected: ${socket.id}`, {
                    socketId: socket.id,
                    userId: socket.userId,
                    username: socket.user?.username
                });
            });
        });

        this.logSuccess('🔌 Socket.IO handlers initialized');
    }

    handleSocketMessage(socket, data) {
        const { roomId, content, type = 'text' } = data;

        if (!socket.userId || !content) return;

        const messageId = uuidv4();
        const message = {
            id: messageId,
            senderId: socket.userId,
            senderUsername: socket.user?.username,
            content: this.sanitize(content),
            type,
            timestamp: new Date(),
            roomId
        };

        // Store message
        this.messages.set(messageId, message);

        // Add to room
        const room = this.chatRooms.get(roomId);
        if (room) {
            room.messages.push(messageId);
        }

        // Emit to room
        this.io.to(roomId).emit('new_message', message);

        this.log(`💬 Message sent in room ${roomId}`, {
            messageId,
            senderId: socket.userId,
            senderUsername: socket.user?.username,
            contentLength: content.length,
            type,
            roomId
        });
    }

    // 🛠️ Utility functions
    sanitize(input) {
        if (typeof input !== 'string') return input;
        return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }

    sanitizeUser(user) {
        const { password, ...safeUser } = user;
        return safeUser;
    }

    log(message, data = null, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const colors = {
            INFO: '\x1b[36m',    // Cyan
            SUCCESS: '\x1b[32m', // Green
            WARNING: '\x1b[33m', // Yellow
            ERROR: '\x1b[31m',   // Red
            DEBUG: '\x1b[35m',   // Magenta
            RESET: '\x1b[0m'     // Reset
        };

        const color = colors[level] || colors.INFO;
        const reset = colors.RESET;

        console.log(`${color}[${timestamp}] [${level}] ${message}${reset}`);
        if (data) {
            console.log(`${color}${JSON.stringify(data, null, 2)}${reset}`);
        }
    }

    logSuccess(message, data = null) {
        this.log(message, data, 'SUCCESS');
    }

    logWarning(message, data = null) {
        this.log(message, data, 'WARNING');
    }

    logError(message, data = null) {
        this.log(message, data, 'ERROR');
    }

    logDebug(message, data = null) {
        this.log(message, data, 'DEBUG');
    }

    // 🚀 Server startup
    startServer() {
        this.server.listen(this.PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(60));
            this.logSuccess(`🚀 INTROVERT Server running on port ${this.PORT}`);
            this.logSuccess(`🌍 Production URL: https://google-8j5x.onrender.com`);
            this.logSuccess(`🔗 Local development: http://localhost:${this.PORT}`);
            this.logSuccess('✨ All systems operational!');
            console.log('='.repeat(60) + '\n');

            // Log server stats
            this.logDebug('📊 Server Statistics', {
                nodeVersion: process.version,
                platform: process.platform,
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                environment: process.env.NODE_ENV || 'development'
            });
        });

        // Enhanced error handling
        this.server.on('error', (error) => {
            this.logError('🚨 Server error occurred', {
                error: error.message,
                code: error.code,
                stack: error.stack
            });
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            this.logWarning('🛑 Shutting down gracefully...');
            this.server.close(() => {
                this.logSuccess('✅ Server closed');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            this.logWarning('🛑 Received SIGINT, shutting down gracefully...');
            this.server.close(() => {
                this.logSuccess('✅ Server closed');
                process.exit(0);
            });
        });

        // Log unhandled errors
        process.on('uncaughtException', (error) => {
            this.logError('🚨 Uncaught Exception', {
                error: error.message,
                stack: error.stack
            });
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            this.logError('🚨 Unhandled Rejection', {
                reason: reason,
                promise: promise
            });
        });
    }
}

// 🎯 Initialize the server
new IntrovertServer();
