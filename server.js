const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// JWT Secret (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'letsbunk_secret_key_2024';

// In-memory storage for demo (replace with proper database in production)
let rooms = [
    { id: 1, room_number: 'CS-101', bssid: '6a:5e:31:58:9b:61', building: 'Computer Science Block', capacity: 50 },
    { id: 2, room_number: 'CS-102', bssid: '2c:4f:22:67:8a:45', building: 'Computer Science Block', capacity: 40 },
    { id: 3, room_number: 'MATH-201', bssid: '8e:3d:11:89:5c:23', building: 'Mathematics Block', capacity: 60 }
];

let teachers = [
    { teacher_id: 'T12345678', name: 'Dr. Alice Brown', email: 'alice.brown@school.com', department: 'Computer Science', phone: '1234567890', password_hash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' },
    { teacher_id: 'T87654321', name: 'Prof. Bob Wilson', email: 'bob.wilson@school.com', department: 'Mathematics', phone: '0987654321', password_hash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' }
];

let students = [
    { student_id: 'S11111111', name: 'John Doe', email: 'john.doe@school.com', class_section: 'CS-A', phone: '1111111111', password_hash: '1ba3d16e9881959f8c9a9762854f72c6e6321cdd44358a10a4e939033117eab9' },
    { student_id: 'S22222222', name: 'Jane Smith', email: 'jane.smith@school.com', class_section: 'CS-A', phone: '2222222222', password_hash: '1ba3d16e9881959f8c9a9762854f72c6e6321cdd44358a10a4e939033117eab9' }
];

let timetable = [
    { id: 1, class_section: 'CS-A', day_of_week: 'Monday', start_time: '09:00', end_time: '10:30', subject: 'Data Structures', teacher_id: 'T12345678', room_id: 1 },
    { id: 2, class_section: 'CS-A', day_of_week: 'Monday', start_time: '11:00', end_time: '12:30', subject: 'Mathematics', teacher_id: 'T87654321', room_id: 3 }
];

let attendance = [];

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

// Student login
app.post('/auth/student/login', (req, res) => {
    const { studentId, password } = req.body;
    
    if (!studentId || !password) {
        return res.status(400).json({
            success: false,
            message: 'Student ID and password are required'
        });
    }
    
    const hashedPassword = hashPassword(password);
    const student = students.find(s => s.student_id === studentId && s.password_hash === hashedPassword);
    
    if (!student) {
        return res.status(401).json({
            success: false,
            message: 'Invalid student ID or password'
        });
    }
    
    const token = jwt.sign(
        { 
            id: student.student_id, 
            name: student.name, 
            class: student.class_section,
            type: 'student' 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    
    res.json({
        success: true,
        message: 'Login successful',
        token: token,
        user: {
            id: student.student_id,
            name: student.name,
            email: student.email,
            class: student.class_section
        }
    });
});

// Teacher login
app.post('/auth/teacher/login', (req, res) => {
    const { teacherId, password } = req.body;
    
    if (!teacherId || !password) {
        return res.status(400).json({
            success: false,
            message: 'Teacher ID and password are required'
        });
    }
    
    const hashedPassword = hashPassword(password);
    const teacher = teachers.find(t => t.teacher_id === teacherId && t.password_hash === hashedPassword);
    
    if (!teacher) {
        return res.status(401).json({
            success: false,
            message: 'Invalid teacher ID or password'
        });
    }
    
    const token = jwt.sign(
        { 
            id: teacher.teacher_id, 
            name: teacher.name, 
            department: teacher.department,
            type: 'teacher' 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    
    res.json({
        success: true,
        message: 'Login successful',
        token: token,
        user: {
            id: teacher.teacher_id,
            name: teacher.name,
            email: teacher.email,
            department: teacher.department
        }
    });
});

// WIFI VALIDATION ENDPOINT
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
    
    // Check if BSSID exists in rooms
    const room = rooms.find(r => r.bssid.toLowerCase() === bssid.toLowerCase());
    
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
    
    const currentClass = timetable.find(t => {
        const teacher = teachers.find(te => te.teacher_id === t.teacher_id);
        return t.room_id === room.id && 
               t.day_of_week === currentDay && 
               t.start_time <= currentTime && 
               t.end_time >= currentTime &&
               (req.user.type === 'teacher' ? t.teacher_id === req.user.id : t.class_section === req.user.class);
    });
    
    let classInfo = null;
    if (currentClass) {
        const teacher = teachers.find(t => t.teacher_id === currentClass.teacher_id);
        classInfo = {
            subject: currentClass.subject,
            teacher_name: teacher ? teacher.name : 'Unknown',
            start_time: currentClass.start_time,
            end_time: currentClass.end_time
        };
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
        currentClass: classInfo
    });
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
    const existingRecord = attendance.find(a => 
        a.student_id === req.user.id && 
        a.room_id === roomId && 
        a.timestamp.startsWith(today) &&
        (!subject || a.subject === subject)
    );
    
    if (existingRecord) {
        return res.json({
            success: false,
            message: 'Attendance already marked for today',
            attendance: existingRecord
        });
    }
    
    // Mark new attendance
    const newAttendance = {
        id: attendance.length + 1,
        student_id: req.user.id,
        class_section: req.user.class,
        subject: subject || 'General',
        teacher_id: teacherId || 'SYSTEM',
        room_id: roomId,
        timestamp: new Date().toISOString(),
        status: 'present'
    };
    
    attendance.push(newAttendance);
    
    console.log(`✅ Attendance marked for ${req.user.name} (${req.user.id}) in room ${roomId}`);
    
    res.json({
        success: true,
        message: 'Attendance marked successfully',
        attendanceId: newAttendance.id,
        timestamp: newAttendance.timestamp
    });
});

// Get attendance history
app.get('/attendance/history', authenticateToken, (req, res) => {
    const { limit = 50, offset = 0 } = req.query;
    
    let userAttendance;
    
    if (req.user.type === 'student') {
        userAttendance = attendance.filter(a => a.student_id === req.user.id);
    } else if (req.user.type === 'teacher') {
        userAttendance = attendance.filter(a => a.teacher_id === req.user.id);
    } else {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized access'
        });
    }
    
    // Add additional info
    const enrichedAttendance = userAttendance.map(record => {
        const room = rooms.find(r => r.id === record.room_id);
        const student = students.find(s => s.student_id === record.student_id);
        const teacher = teachers.find(t => t.teacher_id === record.teacher_id);
        
        return {
            ...record,
            room_number: room ? room.room_number : 'Unknown',
            building: room ? room.building : 'Unknown',
            student_name: student ? student.name : 'Unknown',
            teacher_name: teacher ? teacher.name : 'Unknown'
        };
    });
    
    // Apply pagination
    const paginatedResults = enrichedAttendance
        .slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({
        success: true,
        attendance: paginatedResults,
        count: paginatedResults.length,
        total: enrichedAttendance.length
    });
});

// TIMETABLE ENDPOINTS

// Get timetable
app.get('/timetable', authenticateToken, (req, res) => {
    let userTimetable;
    
    if (req.user.type === 'student') {
        userTimetable = timetable.filter(t => t.class_section === req.user.class);
    } else if (req.user.type === 'teacher') {
        userTimetable = timetable.filter(t => t.teacher_id === req.user.id);
    } else {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized access'
        });
    }
    
    // Add additional info
    const enrichedTimetable = userTimetable.map(entry => {
        const teacher = teachers.find(t => t.teacher_id === entry.teacher_id);
        const room = rooms.find(r => r.id === entry.room_id);
        
        return {
            ...entry,
            teacher_name: teacher ? teacher.name : 'Unknown',
            room_number: room ? room.room_number : 'Unknown',
            building: room ? room.building : 'Unknown'
        };
    });
    
    // Sort by day and time
    const dayOrder = { 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7 };
    enrichedTimetable.sort((a, b) => {
        if (dayOrder[a.day_of_week] !== dayOrder[b.day_of_week]) {
            return dayOrder[a.day_of_week] - dayOrder[b.day_of_week];
        }
        return a.start_time.localeCompare(b.start_time);
    });
    
    res.json({
        success: true,
        timetable: enrichedTimetable
    });
});

// PROFILE ENDPOINTS

// Get user profile
app.get('/profile', authenticateToken, (req, res) => {
    let user;
    
    if (req.user.type === 'student') {
        user = students.find(s => s.student_id === req.user.id);
    } else if (req.user.type === 'teacher') {
        user = teachers.find(t => t.teacher_id === req.user.id);
    }
    
    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }
    
    // Remove password hash from response
    const { password_hash, ...userProfile } = user;
    
    res.json({
        success: true,
        profile: userProfile
    });
});

// ADMIN ENDPOINTS (for testing)

// Add demo data
app.post('/admin/add-demo-data', (req, res) => {
    // Add more demo students
    const demoStudents = [
        { student_id: 'S33333333', name: 'Mike Johnson', email: 'mike.johnson@school.com', class_section: 'CS-B', phone: '3333333333', password_hash: '1ba3d16e9881959f8c9a9762854f72c6e6321cdd44358a10a4e939033117eab9' },
        { student_id: 'S44444444', name: 'Sarah Davis', email: 'sarah.davis@school.com', class_section: 'CS-B', phone: '4444444444', password_hash: '1ba3d16e9881959f8c9a9762854f72c6e6321cdd44358a10a4e939033117eab9' }
    ];
    
    demoStudents.forEach(student => {
        if (!students.find(s => s.student_id === student.student_id)) {
            students.push(student);
        }
    });
    
    res.json({
        success: true,
        message: 'Demo data added successfully',
        studentsCount: students.length,
        teachersCount: teachers.length,
        roomsCount: rooms.length
    });
});

// Health check endpoint (Enhanced)
app.get('/health', (req, res) => {
    res.json({
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        database: {
            connected: true,
            rooms: rooms.length,
            students: students.length,
            teachers: teachers.length,
            attendance: attendance.length
        },
        endpoints: {
            auth: '/auth/student/login, /auth/teacher/login',
            wifi: '/validate-wifi',
            attendance: '/attendance/mark, /attendance/history',
            timetable: '/timetable',
            profile: '/profile'
        },
        demo_credentials: {
            student: { id: 'S11111111', password: 'student123' },
            teacher: { id: 'T12345678', password: 'teacher123' }
        }
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
    console.log(`📱 Ready for APK connections`);
    console.log(`💾 Using in-memory storage (demo mode)`);
    console.log(`👨‍🎓 Demo Student: S11111111 / student123`);
    console.log(`👨‍🏫 Demo Teacher: T12345678 / teacher123`);
});
