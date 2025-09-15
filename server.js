require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient: createRedisClient } = require('redis');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://intro-vert.netlify.app', 'https://introvert-chat.vercel.app']
    : 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests, please try again later.'
});
app.use(limiter);

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || '').split(',');
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: {
        getItem: (key) => {
          const item = localStorage.getItem(key);
          return item ? JSON.parse(item) : null;
        },
        setItem: (key, value) => {
          localStorage.setItem(key, JSON.stringify(value));
        },
        removeItem: (key) => {
          localStorage.removeItem(key);
        }
      }
    }
  }
);

// Initialize Redis for pub/sub and rate limiting
let pubClient, subClient, redisClient;

async function initializeRedis() {
  try {
    if (process.env.REDIS_URL) {
      redisClient = createRedisClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 100, 5000)
        }
      });
      
      await redisClient.connect();
      console.log('Connected to Redis');
      
      pubClient = redisClient.duplicate();
      subClient = redisClient.duplicate();
      
      await Promise.all([pubClient.connect(), subClient.connect()]);
      
      return { pubClient, subClient, redisClient };
    }
  } catch (error) {
    console.error('Redis connection error:', error);
    return { pubClient: null, subClient: null, redisClient: null };
  }
  return { pubClient: null, subClient: null, redisClient: null };
}

// Initialize Socket.IO with Redis adapter
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://intro-vert.netlify.app', 'https://introvert-chat.vercel.app']
      : 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 10000,
  pingInterval: 5000,
  maxHttpBufferSize: 1e8 // 100MB
});

// Initialize Redis adapter if available
initializeRedis().then(({ pubClient, subClient }) => {
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Using Redis adapter for Socket.IO');
  } else {
    console.log('Using in-memory adapter for Socket.IO');
  }
});

// Data structures for in-memory storage
const waitingUsers = [];
const socketIdToUser = new Map();
const pendingProposals = new Map();
const activePartners = new Map();
const userPresence = new Map();
const userSockets = new Map();
const blockedUsers = new Map();
const reportedUsers = new Map();
const typingUsers = new Map();
const onlineUsers = new Set();
const userRooms = new Map();
const groupChats = new Map();

// End-to-end encryption setup
const algorithm = 'aes-256-gcm';
const IV_LENGTH = 16;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(text) {
  const [ivString, authTagString, encryptedText] = text.split(':');
  const iv = Buffer.from(ivString, 'hex');
  const authTag = Buffer.from(authTagString, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// JWT Authentication
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username,
      email: user.email 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1y',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

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
    
    socket.on('message', async (data) => {
        // Only allow messages to confirmed partners
        const partnerId = activePartners.get(socket.id);
        if (!partnerId || partnerId !== data.to) return;
        const payload = {
            message: data.message,
            from: socket.id
        };
        socket.to(partnerId).emit('message', payload);
        // Persist message if supabase configured
        if (supabase) {
            const me = socketIdToUser.get(socket.id);
            const partner = socketIdToUser.get(partnerId);
            try {
                await supabase.from('messages').insert({
                    from_socket_id: socket.id,
                    to_socket_id: partnerId,
                    from_username: me?.username,
                    to_username: partner?.username,
                    body: data.message
                });
            } catch (e) {}
        }
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
        // Start the game, inviter (to) is white, acceptor is black
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

// Recent chats API (simple, by username)
app.get('/api/recent-chats/:username', async (req, res) => {
    if (!supabase) return res.json([]);
    const { username } = req.params;
    const { data, error } = await supabase
        .from('messages')
        .select('id, from_username, to_username, body, created_at')
        .or(`from_username.eq.${username},to_username.eq.${username}`)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
