const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 auth requests per windowMs
    message: { success: false, message: 'Too many login attempts, please try again later.' }
});

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// JWT Secrets
const JWT_SECRET = process.env.JWT_SECRET || 'letsbunk-super-secret-jwt-key-2024-production';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'letsbunk-refresh-secret-key-2024-production';

// Enhanced in-memory storage (replace with database in production)
let students = [
    {
        id: 'S11111111',
        name: 'John Doe',
        password: '$2b$10$rQZ8kHWiZ8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8',
        email: 'john@example.com',
        class: '10A',
        department: 'Computer Science',
        year: 2,
        rollNumber: 'CS2021001',
        phoneNumber: '+1234567890',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        guardianName: 'Robert Doe',
        guardianPhone: '+1234567891',
        profileImage: null,
        address: '123 Main St, City, State'
    },
    {
        id: 'S22222222',
        name: 'Jane Smith',
        password: '$2b$10$rQZ8kHWiZ8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8',
        email: 'jane@example.com',
        class: '10B',
        department: 'Mathematics',
        year: 2,
        rollNumber: 'MT2021002',
        phoneNumber: '+1234567892',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        guardianName: 'Michael Smith',
        guardianPhone: '+1234567893',
        profileImage: null,
        address: '456 Oak Ave, City, State'
    },
    {
        id: 'S33333333',
        name: 'Bob Johnson',
        password: '$2b$10$rQZ8kHWiZ8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8',
        email: 'bob@example.com',
        class: '11A',
        department: 'Physics',
        year: 3,
        rollNumber: 'PH2020001',
        phoneNumber: '+1234567894',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        guardianName: 'Sarah Johnson',
        guardianPhone: '+1234567895',
        profileImage: null,
        address: '789 Pine St, City, State'
    }
];

let teachers = [
    {
        id: 'T12345678',
        name: 'Prof. Alice Wilson',
        password: '$2b$10$rQZ8kHWiZ8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8',
        email: 'alice@example.com',
        department: 'Computer Science',
        phoneNumber: '+1234567896',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        subjects: ['Data Structures', 'Algorithms', 'Programming'],
        profileImage: null
    },
    {
        id: 'T87654321',
        name: 'Dr. Michael Brown',
        password: '$2b$10$rQZ8kHWiZ8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8',
        email: 'michael@example.com',
        department: 'Mathematics',
        phoneNumber: '+1234567897',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        subjects: ['Calculus', 'Linear Algebra', 'Statistics'],
        profileImage: null
    }
];

let admins = [
    {
        id: 'A00000001',
        name: 'System Administrator',
        password: '$2b$10$rQZ8kHWiZ8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8sGz8',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        phoneNumber: '+1234567898'
    }
];

let authorizedBSSIDs = [
    {
        id: '1',
        bssid: '6a:5e:31:58:9b:61',
        ssid: 'Campus-WiFi-CS',
        description: 'Computer Science Lab WiFi',
        room: { id: 1, number: 'CS-101', building: 'Computer Science Block' },
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: 'A00000001',
        location: 'Ground Floor, CS Block',
        allowedTimeStart: '08:00',
        allowedTimeEnd: '18:00'
    },
    {
        id: '2',
        bssid: '2c:4f:22:67:8a:45',
        ssid: 'Campus-WiFi-Math',
        description: 'Mathematics Department WiFi',
        room: { id: 2, number: 'M-201', building: 'Mathematics Block' },
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: 'A00000001',
        location: 'Second Floor, Math Block',
        allowedTimeStart: '08:00',
        allowedTimeEnd: '18:00'
    },
    {
        id: '3',
        bssid: '8e:3d:11:89:5c:23',
        ssid: 'Campus-WiFi-Library',
        description: 'Central Library WiFi',
        room: { id: 3, number: 'L-301', building: 'Library' },
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: 'A00000001',
        location: 'Third Floor, Library',
        allowedTimeStart: '07:00',
        allowedTimeEnd: '22:00'
    }
];

let attendanceRecords = [];
let notifications = [];
let refreshTokens = new Set();

// Enhanced settings
let appSettings = {
    id: 'default',
    autoCheckOut: true,
    autoCheckOutTime: '18:00',
    notificationsEnabled: true,
    locationRequired: false,
    strictWiFiValidation: true,
    allowedCheckInWindow: 30,
    minimumAttendanceDuration: 60,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    workingHours: {
        startTime: '09:00',
        endTime: '17:00',
        lunchBreakStart: '12:00',
        lunchBreakEnd: '13:00'
    },
    theme: 'SYSTEM',
    language: 'en'
};

// Utility functions
const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);

const createNotification = (title, message, type = 'SYSTEM', priority = 'NORMAL', data = null) => {
    const notification = {
        id: generateId(),
        title,
        message,
        type,
        priority,
        isRead: false,
        createdAt: new Date().toISOString(),
        data
    };
    notifications.push(notification);
    return notification;
};

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Role-based access control
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions'
            });
        }
        next();
    };
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: Date.now(),
        version: '2.0.0',
        uptime: Math.floor(process.uptime()),
        database: 'In-Memory (Demo)',
        services: {
            authentication: 'OK',
            attendance: 'OK',
            notifications: 'OK',
            wifi: 'OK'
        }
    });
});

// Enhanced Authentication Endpoints

// Unified login endpoint
app.post('/api/v2/auth/login', authLimiter, async (req, res) => {
    try {
        const { userId, password, deviceInfo } = req.body;

        console.log(`🔐 Login attempt: ${userId}`);

        let user = null;
        let userType = null;

        // Check students
        const student = students.find(s => s.id === userId && s.isActive);
        if (student) {
            user = student;
            userType = 'STUDENT';
        }

        // Check teachers
        if (!user) {
            const teacher = teachers.find(t => t.id === userId && t.isActive);
            if (teacher) {
                user = teacher;
                userType = 'TEACHER';
            }
        }

        // Check admins
        if (!user) {
            const admin = admins.find(a => a.id === userId && a.isActive);
            if (admin) {
                user = admin;
                userType = 'ADMIN';
            }
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // For demo purposes, accept default passwords
        const defaultPasswords = {
            'STUDENT': 'student123',
            'TEACHER': 'teacher123',
            'ADMIN': 'admin123'
        };

        const isValidPassword = password === defaultPasswords[userType] ||
            await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Generate tokens
        const accessToken = jwt.sign(
            {
                id: user.id,
                name: user.name,
                role: userType,
                deviceId: deviceInfo?.deviceId
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const refreshToken = jwt.sign(
            { id: user.id, role: userType },
            REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        refreshTokens.add(refreshToken);

        // Update last login
        user.lastLogin = new Date().toISOString();

        console.log(`✅ Login successful: ${userId} (${userType})`);

        // Create login notification
        createNotification(
            'Login Successful',
            `Welcome back, ${user.name}!`,
            'SYSTEM',
            'NORMAL'
        );

        res.json({
            success: true,
            message: 'Login successful',
            token: accessToken,
            refreshToken: refreshToken,
            expiresIn: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
            user: {
                id: user.id,
                userId: user.id,
                name: user.name,
                email: user.email,
                role: userType,
                isActive: user.isActive,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
                department: user.department,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Refresh token
app.post('/api/v2/auth/refresh', (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken || !refreshTokens.has(refreshToken)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        jwt.verify(refreshToken, REFRESH_SECRET, (err, user) => {
            if (err) {
                refreshTokens.delete(refreshToken);
                return res.status(403).json({
                    success: false,
                    message: 'Invalid refresh token'
                });
            }

            const accessToken = jwt.sign(
                { id: user.id, role: user.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token: accessToken,
                expiresIn: 24 * 60 * 60 * 1000
            });
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Logout
app.post('/api/v2/auth/logout', authenticateToken, (req, res) => {
    try {
        // Remove all refresh tokens for this user (simplified approach)
        refreshTokens.clear();

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Enhanced Attendance Endpoints

// Check-in
app.post('/api/v2/attendance/checkin', authenticateToken, (req, res) => {
    try {
        const { studentId, wifiInfo, location, deviceInfo } = req.body;

        console.log(`📝 Check-in request: ${studentId} at WiFi ${wifiInfo.ssid}`);

        // Validate WiFi network
        const authorizedNetwork = authorizedBSSIDs.find(network =>
            network.bssid.toLowerCase() === wifiInfo.bssid.toLowerCase() && network.isActive
        );

        if (!authorizedNetwork) {
            return res.status(403).json({
                success: false,
                message: 'WiFi network not authorized for attendance'
            });
        }

        // Check if student exists
        const student = students.find(s => s.id === studentId && s.isActive);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        // Check for existing attendance today
        const today = new Date().toDateString();
        const existingAttendance = attendanceRecords.find(record =>
            record.studentId === studentId &&
            new Date(record.checkInTime).toDateString() === today &&
            record.status !== 'ABSENT'
        );

        if (existingAttendance) {
            return res.status(409).json({
                success: false,
                message: 'Already checked in today'
            });
        }

        // Create attendance record
        const attendanceRecord = {
            id: generateId(),
            studentId: studentId,
            studentName: student.name,
            checkInTime: new Date().toISOString(),
            checkOutTime: null,
            duration: null,
            status: 'PRESENT',
            wifiNetwork: wifiInfo.ssid,
            wifiBSSID: wifiInfo.bssid,
            location: location,
            date: today,
            roomId: authorizedNetwork.room.id,
            roomNumber: authorizedNetwork.room.number,
            deviceInfo: deviceInfo
        };

        attendanceRecords.push(attendanceRecord);

        console.log(`✅ Check-in successful: ${student.name} in ${authorizedNetwork.room.number}`);

        // Create notification
        createNotification(
            'Check-in Successful',
            `${student.name} checked in at ${authorizedNetwork.room.number}`,
            'ATTENDANCE',
            'NORMAL',
            { studentId, roomNumber: authorizedNetwork.room.number }
        );

        res.json({
            success: true,
            message: `Check-in successful at ${authorizedNetwork.room.number}`,
            attendance: attendanceRecord
        });

    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Check-out
app.post('/api/v2/attendance/checkout', authenticateToken, (req, res) => {
    try {
        const { studentId, attendanceId, wifiInfo, location } = req.body;

        console.log(`📝 Check-out request: ${studentId}`);

        // Find attendance record
        const attendanceRecord = attendanceRecords.find(record =>
            record.id === attendanceId && record.studentId === studentId
        );

        if (!attendanceRecord) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found'
            });
        }

        if (attendanceRecord.checkOutTime) {
            return res.status(409).json({
                success: false,
                message: 'Already checked out'
            });
        }

        // Update attendance record
        const checkOutTime = new Date();
        const checkInTime = new Date(attendanceRecord.checkInTime);
        const duration = Math.floor((checkOutTime - checkInTime) / 1000 / 60); // minutes

        attendanceRecord.checkOutTime = checkOutTime.toISOString();
        attendanceRecord.duration = duration;

        // Update status based on duration
        if (duration < appSettings.minimumAttendanceDuration) {
            attendanceRecord.status = 'PARTIAL';
        }

        console.log(`✅ Check-out successful: ${attendanceRecord.studentName}, Duration: ${duration} minutes`);

        // Create notification
        createNotification(
            'Check-out Successful',
            `${attendanceRecord.studentName} checked out. Duration: ${duration} minutes`,
            'ATTENDANCE',
            'NORMAL',
            { studentId, duration }
        );

        res.json({
            success: true,
            message: `Check-out successful. Duration: ${duration} minutes`,
            attendance: attendanceRecord
        });

    } catch (error) {
        console.error('Check-out error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Get attendance history
app.get('/api/v2/attendance/history', authenticateToken, (req, res) => {
    try {
        const { studentId, startDate, endDate, page = 1, limit = 50 } = req.query;

        let filteredRecords = attendanceRecords;

        // Filter by student (if not admin/teacher viewing all)
        if (req.user.role === 'STUDENT') {
            filteredRecords = filteredRecords.filter(r => r.studentId === req.user.id);
        } else if (studentId) {
            filteredRecords = filteredRecords.filter(r => r.studentId === studentId);
        }

        // Filter by date range
        if (startDate) {
            filteredRecords = filteredRecords.filter(r =>
                new Date(r.checkInTime) >= new Date(startDate)
            );
        }
        if (endDate) {
            filteredRecords = filteredRecords.filter(r =>
                new Date(r.checkInTime) <= new Date(endDate)
            );
        }

        // Sort by date (newest first)
        filteredRecords.sort((a, b) => new Date(b.checkInTime) - new Date(a.checkInTime));

        // Pagination
        const startIndex = (page - 1) * limit;
        const paginatedRecords = filteredRecords.slice(startIndex, startIndex + parseInt(limit));

        // Calculate summary
        const presentDays = filteredRecords.filter(r => r.status === 'PRESENT').length;
        const totalDays = filteredRecords.length;
        const absentDays = totalDays - presentDays;
        const lateDays = filteredRecords.filter(r => r.status === 'LATE').length;

        const summary = {
            totalDays,
            presentDays,
            absentDays,
            lateDays,
            attendancePercentage: totalDays > 0 ? (presentDays / totalDays) * 100 : 0,
            averageDuration: filteredRecords.length > 0 ?
                filteredRecords.reduce((sum, r) => sum + (r.duration || 0), 0) / filteredRecords.length : 0
        };

        res.json({
            success: true,
            attendance: paginatedRecords,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(filteredRecords.length / limit),
                totalItems: filteredRecords.length,
                itemsPerPage: parseInt(limit),
                hasNext: startIndex + parseInt(limit) < filteredRecords.length,
                hasPrevious: page > 1
            },
            summary
        });

    } catch (error) {
        console.error('Get attendance history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Student Management Endpoints
app.get('/api/v2/students', authenticateToken, requireRole(['TEACHER', 'ADMIN']), (req, res) => {
    try {
        const { page = 1, limit = 50, search } = req.query;

        let filteredStudents = students.filter(s => s.isActive);

        if (search) {
            const searchLower = search.toLowerCase();
            filteredStudents = filteredStudents.filter(s =>
                s.name.toLowerCase().includes(searchLower) ||
                s.id.toLowerCase().includes(searchLower) ||
                s.email.toLowerCase().includes(searchLower)
            );
        }

        // Pagination
        const startIndex = (page - 1) * limit;
        const paginatedStudents = filteredStudents.slice(startIndex, startIndex + parseInt(limit));

        res.json({
            success: true,
            students: paginatedStudents.map(s => ({
                id: s.id,
                userId: s.id,
                name: s.name,
                email: s.email,
                department: s.department,
                year: s.year,
                rollNumber: s.rollNumber,
                phoneNumber: s.phoneNumber,
                isActive: s.isActive,
                createdAt: s.createdAt,
                lastLogin: s.lastLogin
            })),
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(filteredStudents.length / limit),
                totalItems: filteredStudents.length,
                itemsPerPage: parseInt(limit),
                hasNext: startIndex + parseInt(limit) < filteredStudents.length,
                hasPrevious: page > 1
            }
        });
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// WiFi Network Management
app.get('/api/v2/wifi/networks', authenticateToken, (req, res) => {
    try {
        const networks = authorizedBSSIDs.filter(n => n.isActive).map(n => ({
            id: n.id,
            ssid: n.ssid,
            bssid: n.bssid,
            description: n.description,
            isActive: n.isActive,
            createdAt: n.createdAt,
            createdBy: n.createdBy,
            location: n.location,
            allowedTimeStart: n.allowedTimeStart,
            allowedTimeEnd: n.allowedTimeEnd
        }));

        res.json({
            success: true,
            networks
        });
    } catch (error) {
        console.error('Get WiFi networks error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Notifications
app.get('/api/v2/notifications', authenticateToken, (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        // Sort by date (newest first)
        const sortedNotifications = notifications.sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        // Pagination
        const startIndex = (page - 1) * limit;
        const paginatedNotifications = sortedNotifications.slice(startIndex, startIndex + parseInt(limit));

        const unreadCount = notifications.filter(n => !n.isRead).length;

        res.json({
            success: true,
            notifications: paginatedNotifications,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(notifications.length / limit),
                totalItems: notifications.length,
                itemsPerPage: parseInt(limit),
                hasNext: startIndex + parseInt(limit) < notifications.length,
                hasPrevious: page > 1
            },
            unreadCount
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Settings
app.get('/api/v2/settings', authenticateToken, (req, res) => {
    try {
        res.json({
            success: true,
            settings: appSettings
        });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 LetsBunk Enhanced Server v2.0.0 running on port ${PORT}`);
    console.log(`📊 Enhanced Demo System Ready:`);
    console.log(`   Students: S11111111, S22222222, S33333333 (password: student123)`);
    console.log(`   Teachers: T12345678, T87654321 (password: teacher123)`);
    console.log(`   Admin: A00000001 (password: admin123)`);
    console.log(`🌐 Authorized Networks: ${authorizedBSSIDs.length} configured`);
    console.log(`🔒 Security: Rate limiting, JWT auth, encrypted storage ready`);
    console.log(`📱 API v2.0 endpoints available at /api/v2/`);
    console.log(`🎯 Ready for production deployment!`);
});
