const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT Secret (in production, use environment variable)
const JWT_SECRET = 'letsbunk_secret_key_2024';

// Database connection
const db = new sqlite3.Database('./letsbunk_admin.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('📊 Connected to SQLite database');
    }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Helper function to hash passwords (for compatibility with admin system)
const hashPassword = (password) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(password).digest('hex');
};

// AUTHENTICATION ENDPOINTS

// Active sessions tracking
const activeSessions = [];

// Student login
app.post('/auth/student/login', (req, res) => {
    const { studentId, password, deviceId } = req.body;
    
    if (!studentId || !password) {
        return res.status(400).json({
            success: false,
            message: 'Student ID and password are required'
        });
    }
    
    const hashedPassword = hashPassword(password);
    
    db.get(
        'SELECT * FROM students WHERE student_id = ? AND password_hash = ?',
        [studentId, hashedPassword],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Database error'
                });
            }
            
            if (!row) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid student ID or password'
                });
            }
            
            // Check for existing sessions (optional - can be disabled for testing)
            const existingSession = activeSessions.find(s => s.userId === studentId);
            const deviceSession = activeSessions.find(s => s.deviceId === deviceId && s.userId !== studentId);
            
            // For now, allow multiple sessions (comment out for production)
            /*
            if (existingSession && existingSession.deviceId !== deviceId) {
                return res.status(409).json({
                    success: false,
                    message: 'Account is already logged in on another device'
                });
            }
            
            if (deviceSession) {
                return res.status(409).json({
                    success: false,
                    message: 'Another account is already logged in on this device'
                });
            }
            */
            
            const token = jwt.sign(
                { 
                    id: row.student_id, 
                    name: row.name, 
                    class: row.class_section,
                    type: 'student',
                    deviceId: deviceId || 'unknown'
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            // Update or create session
            const sessionIndex = activeSessions.findIndex(s => s.userId === studentId);
            const sessionData = {
                userId: studentId,
                deviceId: deviceId || 'unknown',
                loginTime: new Date().toISOString(),
                lastActivity: new Date().toISOString()
            };
            
            if (sessionIndex >= 0) {
                activeSessions[sessionIndex] = sessionData;
            } else {
                activeSessions.push(sessionData);
            }
            
            console.log(`✅ Student login: ${row.name} (${studentId}) on device ${deviceId || 'unknown'}`);
            
            res.json({
                success: true,
                message: 'Login successful',
                token: token,
                user: {
                    id: row.student_id,
                    name: row.name,
                    email: row.email,
                    class: row.class_section
                }
            });
        }
    );
});

// Teacher login
app.post('/auth/teacher/login', (req, res) => {
    const { teacherId, password, deviceId } = req.body;
    
    if (!teacherId || !password) {
        return res.status(400).json({
            success: false,
            message: 'Teacher ID and password are required'
        });
    }
    
    const hashedPassword = hashPassword(password);
    
    db.get(
        'SELECT * FROM teachers WHERE teacher_id = ? AND password_hash = ?',
        [teacherId, hashedPassword],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Database error'
                });
            }
            
            if (!row) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid teacher ID or password'
                });
            }
            
            const token = jwt.sign(
                { 
                    id: row.teacher_id, 
                    name: row.name, 
                    department: row.department,
                    type: 'teacher',
                    deviceId: deviceId || 'unknown'
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            // Update teacher session
            const sessionIndex = activeSessions.findIndex(s => s.userId === teacherId);
            const sessionData = {
                userId: teacherId,
                deviceId: deviceId || 'unknown',
                loginTime: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                userType: 'teacher'
            };
            
            if (sessionIndex >= 0) {
                activeSessions[sessionIndex] = sessionData;
            } else {
                activeSessions.push(sessionData);
            }
            
            console.log(`✅ Teacher login: ${row.name} (${teacherId}) on device ${deviceId || 'unknown'}`);
            
            res.json({
                success: true,
                message: 'Login successful',
                token: token,
                user: {
                    id: row.teacher_id,
                    name: row.name,
                    email: row.email,
                    department: row.department
                }
            });
        }
    );
});

// SESSION MANAGEMENT ENDPOINTS

// Logout endpoint
app.post('/auth/logout', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const deviceId = req.user.deviceId;
    
    // Remove session
    const sessionIndex = activeSessions.findIndex(s => s.userId === userId && s.deviceId === deviceId);
    if (sessionIndex >= 0) {
        activeSessions.splice(sessionIndex, 1);
    }
    
    console.log(`🚪 User logout: ${userId} from device ${deviceId}`);
    
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// Get active sessions (admin only)
app.get('/admin/sessions', (req, res) => {
    res.json({
        success: true,
        sessions: activeSessions,
        count: activeSessions.length
    });
});

// Clear all sessions (admin only)
app.post('/admin/clear-sessions', (req, res) => {
    const clearedCount = activeSessions.length;
    activeSessions.length = 0;
    
    res.json({
        success: true,
        message: `Cleared ${clearedCount} active sessions`
    });
});

// ADMIN DATA SYNC ENDPOINTS

// Sync room data
app.post('/admin/sync/rooms', (req, res) => {
    const { rooms } = req.body;
    
    if (!rooms || !Array.isArray(rooms)) {
        return res.status(400).json({
            success: false,
            message: 'Rooms array is required'
        });
    }
    
    console.log(`📊 Syncing ${rooms.length} rooms from admin panel`);
    
    // Clear existing rooms and insert new ones
    db.serialize(() => {
        db.run('DELETE FROM rooms');
        
        const stmt = db.prepare(`
            INSERT INTO rooms (room_number, bssid, building, capacity)
            VALUES (?, ?, ?, ?)
        `);
        
        rooms.forEach(room => {
            stmt.run([room.room_number, room.bssid, room.building, room.capacity]);
        });
        
        stmt.finalize();
    });
    
    res.json({
        success: true,
        message: `Synced ${rooms.length} rooms successfully`
    });
});

// Sync teacher data
app.post('/admin/sync/teachers', (req, res) => {
    const { teachers } = req.body;
    
    if (!teachers || !Array.isArray(teachers)) {
        return res.status(400).json({
            success: false,
            message: 'Teachers array is required'
        });
    }
    
    console.log(`👨‍🏫 Syncing ${teachers.length} teachers from admin panel`);
    
    db.serialize(() => {
        db.run('DELETE FROM teachers');
        
        const stmt = db.prepare(`
            INSERT INTO teachers (teacher_id, name, email, department, phone, password_hash)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        teachers.forEach(teacher => {
            stmt.run([
                teacher.teacher_id, 
                teacher.name, 
                teacher.email, 
                teacher.department, 
                teacher.phone, 
                teacher.password_hash
            ]);
        });
        
        stmt.finalize();
    });
    
    res.json({
        success: true,
        message: `Synced ${teachers.length} teachers successfully`
    });
});

// Sync student data
app.post('/admin/sync/students', (req, res) => {
    const { students } = req.body;
    
    if (!students || !Array.isArray(students)) {
        return res.status(400).json({
            success: false,
            message: 'Students array is required'
        });
    }
    
    console.log(`👨‍🎓 Syncing ${students.length} students from admin panel`);
    
    db.serialize(() => {
        db.run('DELETE FROM students');
        
        const stmt = db.prepare(`
            INSERT INTO students (student_id, name, email, class_section, phone, password_hash)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        students.forEach(student => {
            stmt.run([
                student.student_id,
                student.name,
                student.email,
                student.class_section,
                student.phone,
                student.password_hash
            ]);
        });
        
        stmt.finalize();
    });
    
    res.json({
        success: true,
        message: `Synced ${students.length} students successfully`
    });
});

// Sync timetable data
app.post('/admin/sync/timetable', (req, res) => {
    const { timetable } = req.body;
    
    if (!timetable || !Array.isArray(timetable)) {
        return res.status(400).json({
            success: false,
            message: 'Timetable array is required'
        });
    }
    
    console.log(`📅 Syncing ${timetable.length} timetable entries from admin panel`);
    
    db.serialize(() => {
        db.run('DELETE FROM timetable');
        
        const stmt = db.prepare(`
            INSERT INTO timetable (class_section, day_of_week, start_time, end_time, subject, teacher_id, room_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        timetable.forEach(entry => {
            stmt.run([
                entry.class_section,
                entry.day_of_week,
                entry.start_time,
                entry.end_time,
                entry.subject,
                entry.teacher_id,
                entry.room_id
            ]);
        });
        
        stmt.finalize();
    });
    
    res.json({
        success: true,
        message: `Synced ${timetable.length} timetable entries successfully`
    });
});

// WIFI VALIDATION ENDPOINT (Enhanced)
app.post('/validate-wifi', authenticateToken, (req, res) => {
    const { bssid } = req.body;
    
    console.log(`📶 BSSID validation request from ${req.user.type}: ${req.user.name} (${req.user.id})`);
    console.log(`📍 BSSID: ${bssid}`);
    
    if (!bssid) {
        return res.status(400).json({
            success: false,
            message: 'BSSID is required'
        });
    }
    
    // Check if BSSID exists in rooms table
    db.get(
        'SELECT * FROM rooms WHERE bssid = ?',
        [bssid.toLowerCase()],
        (err, room) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Database error'
                });
            }
            
            if (!room) {
                console.log(`❌ BSSID ${bssid} is NOT AUTHORIZED`);
                return res.json({
                    success: false,
                    message: 'This WiFi network is not authorized for attendance',
                    bssid: bssid
                });
            }
            
            console.log(`✅ BSSID ${bssid} is AUTHORIZED - Room: ${room.room_number}`);
            
            // Get current class info if available
            const currentTime = new Date().toTimeString().slice(0, 5); // HH:MM format
            const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });
            
            db.get(`
                SELECT t.*, te.name as teacher_name, r.room_number 
                FROM timetable t
                JOIN teachers te ON t.teacher_id = te.teacher_id
                JOIN rooms r ON t.room_id = r.id
                WHERE r.bssid = ? AND t.day_of_week = ? 
                AND t.start_time <= ? AND t.end_time >= ?
                ${req.user.type === 'student' ? 'AND t.class_section = ?' : ''}
            `, 
            req.user.type === 'student' 
                ? [bssid.toLowerCase(), currentDay, currentTime, currentTime, req.user.class]
                : [bssid.toLowerCase(), currentDay, currentTime, currentTime],
            (err, classInfo) => {
                if (err) {
                    console.error('Timetable query error:', err);
                }
                
                res.json({
                    success: true,
                    message: 'WiFi network is authorized for attendance',
                    room: {
                        id: room.id,
                        number: room.room_number,
                        building: room.building,
                        bssid: room.bssid
                    },
                    currentClass: classInfo || null
                });
            });
        }
    );
});

// ATTENDANCE ENDPOINTS

// Mark attendance
app.post('/attendance/mark', authenticateToken, (req, res) => {
    const { roomId, subject, teacherId } = req.body;
    
    if (req.user.type !== 'student') {
        return res.status(403).json({
            success: false,
            message: 'Only students can mark attendance'
        });
    }
    
    if (!roomId) {
        return res.status(400).json({
            success: false,
            message: 'Room ID is required'
        });
    }
    
    // Check if attendance already marked for today
    const today = new Date().toISOString().split('T')[0];
    
    db.get(`
        SELECT * FROM attendance 
        WHERE student_id = ? AND room_id = ? 
        AND DATE(timestamp) = ?
        ${subject ? 'AND subject = ?' : ''}
    `, 
    subject 
        ? [req.user.id, roomId, today, subject]
        : [req.user.id, roomId, today],
    (err, existingRecord) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                success: false,
                message: 'Database error'
            });
        }
        
        if (existingRecord) {
            return res.json({
                success: false,
                message: 'Attendance already marked for today',
                attendance: existingRecord
            });
        }
        
        // Mark new attendance
        db.run(`
            INSERT INTO attendance (student_id, class_section, subject, teacher_id, room_id, status)
            VALUES (?, ?, ?, ?, ?, 'present')
        `, [req.user.id, req.user.class, subject || 'General', teacherId || 'SYSTEM', roomId], 
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to mark attendance'
                });
            }
            
            console.log(`✅ Attendance marked for ${req.user.name} (${req.user.id}) in room ${roomId}`);
            
            res.json({
                success: true,
                message: 'Attendance marked successfully',
                attendanceId: this.lastID,
                timestamp: new Date().toISOString()
            });
        });
    });
});

// Get student's attendance history
app.get('/attendance/history', authenticateToken, (req, res) => {
    const { limit = 50, offset = 0 } = req.query;
    
    let query, params;
    
    if (req.user.type === 'student') {
        query = `
            SELECT a.*, r.room_number, r.building, t.name as teacher_name
            FROM attendance a
            JOIN rooms r ON a.room_id = r.id
            LEFT JOIN teachers t ON a.teacher_id = t.teacher_id
            WHERE a.student_id = ?
            ORDER BY a.timestamp DESC
            LIMIT ? OFFSET ?
        `;
        params = [req.user.id, parseInt(limit), parseInt(offset)];
    } else if (req.user.type === 'teacher') {
        query = `
            SELECT a.*, s.name as student_name, r.room_number, r.building
            FROM attendance a
            JOIN students s ON a.student_id = s.student_id
            JOIN rooms r ON a.room_id = r.id
            WHERE a.teacher_id = ?
            ORDER BY a.timestamp DESC
            LIMIT ? OFFSET ?
        `;
        params = [req.user.id, parseInt(limit), parseInt(offset)];
    } else {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized access'
        });
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                success: false,
                message: 'Database error'
            });
        }
        
        res.json({
            success: true,
            attendance: rows,
            count: rows.length
        });
    });
});

// TIMETABLE ENDPOINTS

// Get timetable
app.get('/timetable', authenticateToken, (req, res) => {
    let query, params;
    
    if (req.user.type === 'student') {
        query = `
            SELECT t.*, te.name as teacher_name, r.room_number, r.building
            FROM timetable t
            JOIN teachers te ON t.teacher_id = te.teacher_id
            JOIN rooms r ON t.room_id = r.id
            WHERE t.class_section = ?
            ORDER BY 
                CASE t.day_of_week 
                    WHEN 'Monday' THEN 1 
                    WHEN 'Tuesday' THEN 2 
                    WHEN 'Wednesday' THEN 3 
                    WHEN 'Thursday' THEN 4 
                    WHEN 'Friday' THEN 5 
                    WHEN 'Saturday' THEN 6 
                    ELSE 7 
                END, t.start_time
        `;
        params = [req.user.class];
    } else if (req.user.type === 'teacher') {
        query = `
            SELECT t.*, r.room_number, r.building
            FROM timetable t
            JOIN rooms r ON t.room_id = r.id
            WHERE t.teacher_id = ?
            ORDER BY 
                CASE t.day_of_week 
                    WHEN 'Monday' THEN 1 
                    WHEN 'Tuesday' THEN 2 
                    WHEN 'Wednesday' THEN 3 
                    WHEN 'Thursday' THEN 4 
                    WHEN 'Friday' THEN 5 
                    WHEN 'Saturday' THEN 6 
                    ELSE 7 
                END, t.start_time
        `;
        params = [req.user.id];
    } else {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized access'
        });
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                success: false,
                message: 'Database error'
            });
        }
        
        res.json({
            success: true,
            timetable: rows
        });
    });
});

// PROFILE ENDPOINTS

// Get user profile
app.get('/profile', authenticateToken, (req, res) => {
    const table = req.user.type === 'student' ? 'students' : 'teachers';
    const idField = req.user.type === 'student' ? 'student_id' : 'teacher_id';
    
    db.get(`SELECT * FROM ${table} WHERE ${idField} = ?`, [req.user.id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                success: false,
                message: 'Database error'
            });
        }
        
        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Remove password hash from response
        delete row.password_hash;
        
        res.json({
            success: true,
            profile: row
        });
    });
});

// Health check endpoint (Enhanced)
app.get('/health', (req, res) => {
    // Get database stats
    db.get('SELECT COUNT(*) as room_count FROM rooms', (err, roomData) => {
        db.get('SELECT COUNT(*) as student_count FROM students', (err2, studentData) => {
            db.get('SELECT COUNT(*) as teacher_count FROM teachers', (err3, teacherData) => {
                res.json({
                    status: 'Server is running',
                    timestamp: new Date().toISOString(),
                    database: {
                        connected: !err && !err2 && !err3,
                        rooms: roomData ? roomData.room_count : 0,
                        students: studentData ? studentData.student_count : 0,
                        teachers: teacherData ? teacherData.teacher_count : 0
                    },
                    endpoints: {
                        auth: '/auth/student/login, /auth/teacher/login, /auth/logout',
                        wifi: '/validate-wifi',
                        attendance: '/attendance/mark, /attendance/history',
                        timetable: '/timetable',
                        profile: '/profile',
                        admin: '/admin/sessions, /admin/clear-sessions',
                        sync: '/admin/sync/rooms, /admin/sync/teachers, /admin/sync/students, /admin/sync/timetable'
                    }
                });
            });
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Let's Bunk Server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Authentication endpoints available`);
    console.log(`📊 Database integration active`);
    console.log(`📱 Ready for APK connections`);
});
