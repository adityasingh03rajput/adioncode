const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration for production
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? ['https://your-admin-domain.com', 'https://letsbunk-admin.netlify.app']
        : true,
    credentials: true,
    optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// Security headers
app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    next();
});

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
    { student_id: 'S11111111', name: 'John Doe', email: 'john.doe@school.com', class_section: 'CS-A', phone: '1111111111', password_hash: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b' },
    { student_id: 'S22222222', name: 'Jane Smith', email: 'jane.smith@school.com', class_section: 'CS-A', phone: '2222222222', password_hash: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b' }
];

let timetable = [
    { id: 1, class_section: 'CS-A', day_of_week: 'Monday', start_time: '09:00', end_time: '10:30', subject: 'Data Structures', teacher_id: 'T12345678', room_id: 1 },
    { id: 2, class_section: 'CS-A', day_of_week: 'Monday', start_time: '11:00', end_time: '12:30', subject: 'Mathematics', teacher_id: 'T87654321', room_id: 3 }
];

let attendance = [];
let activeSessions = []; // Track active user sessions with device info

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
    const { studentId, password, deviceId } = req.body;

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

    // Check for existing sessions
    const existingSession = activeSessions.find(s => s.userId === studentId);
    const deviceSession = activeSessions.find(s => s.deviceId === deviceId && s.userId !== studentId);

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

    const token = jwt.sign(
        {
            id: student.student_id,
            name: student.name,
            class: student.class_section,
            type: 'student',
            deviceId: deviceId
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

    console.log(`🔐 Student login: ${student.name} (${studentId}) on device ${deviceId}`);

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
    const { teacherId, password, deviceId } = req.body;

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

    // Check for existing sessions
    const existingSession = activeSessions.find(s => s.userId === teacherId);
    const deviceSession = activeSessions.find(s => s.deviceId === deviceId && s.userId !== teacherId);

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

    const token = jwt.sign(
        {
            id: teacher.teacher_id,
            name: teacher.name,
            department: teacher.department,
            type: 'teacher',
            deviceId: deviceId
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    // Update or create session
    const sessionIndex = activeSessions.findIndex(s => s.userId === teacherId);
    const sessionData = {
        userId: teacherId,
        deviceId: deviceId || 'unknown',
        loginTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
    };

    if (sessionIndex >= 0) {
        activeSessions[sessionIndex] = sessionData;
    } else {
        activeSessions.push(sessionData);
    }

    console.log(`🔐 Teacher login: ${teacher.name} (${teacherId}) on device ${deviceId}`);

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

// Logout endpoint
app.post('/auth/logout', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const deviceId = req.user.deviceId;

    // Remove session
    const sessionIndex = activeSessions.findIndex(s => s.userId === userId && s.deviceId === deviceId);
    if (sessionIndex >= 0) {
        activeSessions.splice(sessionIndex, 1);
        console.log(`🔓 User logout: ${userId} from device ${deviceId}`);
    }

    res.json({
        success: true,
        message: 'Logged out successfully'
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

// ADMIN ENDPOINTS

// Sync endpoints for admin panel
app.post('/admin/sync/room', (req, res) => {
    const { id, room_number, bssid, building, capacity } = req.body;

    // Find existing room or create new
    const existingIndex = rooms.findIndex(r => r.id === id || r.room_number === room_number);
    const roomData = {
        id: id || rooms.length + 1,
        room_number,
        bssid: bssid.toLowerCase(),
        building,
        capacity: capacity || 50
    };

    if (existingIndex >= 0) {
        rooms[existingIndex] = roomData;
    } else {
        rooms.push(roomData);
    }

    console.log(`📍 Room synced: ${room_number} (${bssid})`);
    res.json({ success: true, message: 'Room synced successfully' });
});

app.post('/admin/sync/teacher', (req, res) => {
    const { teacher_id, name, email, department, phone, password_hash } = req.body;

    const existingIndex = teachers.findIndex(t => t.teacher_id === teacher_id);
    const teacherData = {
        teacher_id,
        name,
        email,
        department,
        phone,
        password_hash
    };

    if (existingIndex >= 0) {
        teachers[existingIndex] = teacherData;
    } else {
        teachers.push(teacherData);
    }

    console.log(`👨‍🏫 Teacher synced: ${name} (${teacher_id})`);
    res.json({ success: true, message: 'Teacher synced successfully' });
});

app.post('/admin/sync/student', (req, res) => {
    const { student_id, name, email, class_section, phone, password_hash } = req.body;

    const existingIndex = students.findIndex(s => s.student_id === student_id);
    const studentData = {
        student_id,
        name,
        email,
        class_section,
        phone,
        password_hash
    };

    if (existingIndex >= 0) {
        students[existingIndex] = studentData;
    } else {
        students.push(studentData);
    }

    console.log(`👨‍🎓 Student synced: ${name} (${student_id})`);
    res.json({ success: true, message: 'Student synced successfully' });
});

app.post('/admin/sync/timetable', (req, res) => {
    const { id, class_section, day_of_week, start_time, end_time, subject, teacher_id, room_id } = req.body;

    const existingIndex = timetable.findIndex(t => t.id === id);
    const timetableData = {
        id: id || timetable.length + 1,
        class_section,
        day_of_week,
        start_time,
        end_time,
        subject,
        teacher_id,
        room_id
    };

    if (existingIndex >= 0) {
        timetable[existingIndex] = timetableData;
    } else {
        timetable.push(timetableData);
    }

    console.log(`📅 Timetable synced: ${subject} - ${class_section} (${day_of_week})`);
    res.json({ success: true, message: 'Timetable synced successfully' });
});

// BULK SYNC ENDPOINTS (for admin panel)

// Bulk sync rooms
app.post('/admin/sync/rooms', (req, res) => {
    const { rooms: newRooms } = req.body;

    if (!newRooms || !Array.isArray(newRooms)) {
        return res.status(400).json({
            success: false,
            message: 'Rooms array is required'
        });
    }

    console.log(`📊 Bulk syncing ${newRooms.length} rooms from admin panel`);

    // Replace all rooms with new data
    rooms = newRooms.map((room, index) => ({
        id: room.id || index + 1,
        room_number: room.room_number,
        bssid: room.bssid.toLowerCase(),
        building: room.building || 'Unknown',
        capacity: room.capacity || 50
    }));

    res.json({
        success: true,
        message: `Synced ${rooms.length} rooms successfully`
    });
});

// Bulk sync teachers
app.post('/admin/sync/teachers', (req, res) => {
    const { teachers: newTeachers } = req.body;

    if (!newTeachers || !Array.isArray(newTeachers)) {
        return res.status(400).json({
            success: false,
            message: 'Teachers array is required'
        });
    }

    console.log(`👨‍🏫 Bulk syncing ${newTeachers.length} teachers from admin panel`);

    // Replace all teachers with new data
    teachers = newTeachers.map(teacher => ({
        teacher_id: teacher.teacher_id,
        name: teacher.name,
        email: teacher.email,
        department: teacher.department || 'General',
        phone: teacher.phone || '',
        password_hash: teacher.password_hash
    }));

    res.json({
        success: true,
        message: `Synced ${teachers.length} teachers successfully`
    });
});

// Bulk sync students
app.post('/admin/sync/students', (req, res) => {
    const { students: newStudents } = req.body;

    if (!newStudents || !Array.isArray(newStudents)) {
        return res.status(400).json({
            success: false,
            message: 'Students array is required'
        });
    }

    console.log(`👨‍🎓 Bulk syncing ${newStudents.length} students from admin panel`);

    // Replace all students with new data
    students = newStudents.map(student => ({
        student_id: student.student_id,
        name: student.name,
        email: student.email,
        class_section: student.class_section || 'General',
        phone: student.phone || '',
        password_hash: student.password_hash
    }));

    res.json({
        success: true,
        message: `Synced ${students.length} students successfully`
    });
});

// Bulk sync timetable
app.post('/admin/sync/timetable', (req, res) => {
    const { timetable: newTimetable } = req.body;

    if (!newTimetable || !Array.isArray(newTimetable)) {
        return res.status(400).json({
            success: false,
            message: 'Timetable array is required'
        });
    }

    console.log(`📅 Bulk syncing ${newTimetable.length} timetable entries from admin panel`);

    // Replace all timetable with new data
    timetable = newTimetable.map((entry, index) => ({
        id: entry.id || index + 1,
        class_section: entry.class_section,
        day_of_week: entry.day_of_week,
        start_time: entry.start_time,
        end_time: entry.end_time,
        subject: entry.subject,
        teacher_id: entry.teacher_id,
        room_id: entry.room_id
    }));

    res.json({
        success: true,
        message: `Synced ${timetable.length} timetable entries successfully`
    });
});

// Add demo data
app.post('/admin/add-demo-data', (req, res) => {
    // Add more demo students
    const demoStudents = [
        { student_id: 'S33333333', name: 'Mike Johnson', email: 'mike.johnson@school.com', class_section: 'CS-B', phone: '3333333333', password_hash: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b' },
        { student_id: 'S44444444', name: 'Sarah Davis', email: 'sarah.davis@school.com', class_section: 'CS-B', phone: '4444444444', password_hash: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b' }
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

// ADMIN MANAGEMENT ENDPOINTS

// Get all data for admin dashboard
app.get('/admin/dashboard', (req, res) => {
    const stats = {
        rooms: rooms.length,
        students: students.length,
        teachers: teachers.length,
        timetable: timetable.length,
        attendance: attendance.length,
        activeSessions: activeSessions.length,
        recentAttendance: attendance.slice(-10).map(a => ({
            ...a,
            student_name: students.find(s => s.student_id === a.student_id)?.name || 'Unknown',
            room_name: rooms.find(r => r.id === a.room_id)?.room_number || 'Unknown'
        }))
    };

    res.json({
        success: true,
        stats: stats,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// Clear all data (admin only)
app.post('/admin/clear-all', (req, res) => {
    const { confirm } = req.body;

    if (confirm !== 'CLEAR_ALL_DATA') {
        return res.status(400).json({
            success: false,
            message: 'Confirmation required. Send {"confirm": "CLEAR_ALL_DATA"}'
        });
    }

    // Keep demo data but clear user-added data
    rooms = [
        { id: 1, room_number: 'CS-101', bssid: '6a:5e:31:58:9b:61', building: 'Computer Science Block', capacity: 50 },
        { id: 2, room_number: 'CS-102', bssid: '2c:4f:22:67:8a:45', building: 'Computer Science Block', capacity: 40 },
        { id: 3, room_number: 'MATH-201', bssid: '8e:3d:11:89:5c:23', building: 'Mathematics Block', capacity: 60 }
    ];

    teachers = [
        { teacher_id: 'T12345678', name: 'Dr. Alice Brown', email: 'alice.brown@school.com', department: 'Computer Science', phone: '1234567890', password_hash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' },
        { teacher_id: 'T87654321', name: 'Prof. Bob Wilson', email: 'bob.wilson@school.com', department: 'Mathematics', phone: '0987654321', password_hash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' }
    ];

    students = [
        { student_id: 'S11111111', name: 'John Doe', email: 'john.doe@school.com', class_section: 'CS-A', phone: '1111111111', password_hash: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b' },
        { student_id: 'S22222222', name: 'Jane Smith', email: 'jane.smith@school.com', class_section: 'CS-A', phone: '2222222222', password_hash: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b' }
    ];

    timetable = [
        { id: 1, class_section: 'CS-A', day_of_week: 'Monday', start_time: '09:00', end_time: '10:30', subject: 'Data Structures', teacher_id: 'T12345678', room_id: 1 },
        { id: 2, class_section: 'CS-A', day_of_week: 'Monday', start_time: '11:00', end_time: '12:30', subject: 'Mathematics', teacher_id: 'T87654321', room_id: 3 }
    ];

    attendance = [];
    activeSessions = [];

    console.log('🧹 All data cleared, reset to demo state');

    res.json({
        success: true,
        message: 'All data cleared successfully',
        timestamp: new Date().toISOString()
    });
});

// Get active sessions
app.get('/admin/sessions', (req, res) => {
    const sessionsWithDetails = activeSessions.map(session => {
        const user = students.find(s => s.student_id === session.userId) ||
            teachers.find(t => t.teacher_id === session.userId);

        return {
            ...session,
            userName: user?.name || 'Unknown',
            userType: students.find(s => s.student_id === session.userId) ? 'student' : 'teacher'
        };
    });

    res.json({
        success: true,
        sessions: sessionsWithDetails,
        count: activeSessions.length
    });
});

// Clear specific session
app.post('/admin/clear-session', (req, res) => {
    const { userId, deviceId } = req.body;

    const sessionIndex = activeSessions.findIndex(s =>
        s.userId === userId && (!deviceId || s.deviceId === deviceId)
    );

    if (sessionIndex >= 0) {
        const removedSession = activeSessions.splice(sessionIndex, 1)[0];
        console.log(`🔓 Admin cleared session: ${removedSession.userId} from ${removedSession.deviceId}`);

        res.json({
            success: true,
            message: 'Session cleared successfully'
        });
    } else {
        res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    res.json({
        status: '🚀 Server is running perfectly',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        uptime: {
            seconds: Math.floor(uptime),
            formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
        },
        memory: {
            used: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
            total: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
            external: `${Math.round(memory.external / 1024 / 1024)}MB`
        },
        database: {
            status: '✅ Connected (In-Memory)',
            rooms: rooms.length,
            students: students.length,
            teachers: teachers.length,
            timetable: timetable.length,
            attendance: attendance.length,
            activeSessions: activeSessions.length
        },
        endpoints: {
            authentication: [
                'POST /auth/student/login',
                'POST /auth/teacher/login',
                'POST /auth/logout'
            ],
            wifi: [
                'POST /validate-wifi'
            ],
            attendance: [
                'POST /attendance/mark',
                'GET /attendance/history'
            ],
            profile: [
                'GET /profile',
                'GET /timetable'
            ],
            admin: [
                'GET /admin/dashboard',
                'GET /admin/sessions',
                'POST /admin/clear-session',
                'POST /admin/clear-all'
            ],
            sync: [
                'POST /admin/sync/rooms',
                'POST /admin/sync/teachers',
                'POST /admin/sync/students',
                'POST /admin/sync/timetable'
            ]
        },
        demo_credentials: {
            student: {
                id: 'S11111111',
                password: 'student123',
                note: 'Use these credentials to test the mobile app'
            },
            teacher: {
                id: 'T12345678',
                password: 'teacher123',
                note: 'Use these credentials to test teacher features'
            }
        },
        features: [
            '🔐 JWT Authentication',
            '📱 Mobile App Support',
            '📍 WiFi-based Attendance',
            '👥 Session Management',
            '📊 Admin Dashboard',
            '🔄 Real-time Sync',
            '📋 Bulk Data Import',
            '🛡️ Security Headers'
        ]
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

// 404 handler for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        availableEndpoints: [
            'GET /health - Server status',
            'POST /auth/student/login - Student authentication',
            'POST /auth/teacher/login - Teacher authentication',
            'POST /validate-wifi - WiFi validation',
            'POST /attendance/mark - Mark attendance',
            'GET /admin/dashboard - Admin dashboard'
        ]
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🎉 LetsBunk Server v2.0 Started Successfully!');
    console.log('='.repeat(50));
    console.log(`🚀 Server running on port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin/dashboard`);
    console.log('\n📱 Mobile App Endpoints:');
    console.log('  • POST /auth/student/login - Student login');
    console.log('  • POST /auth/teacher/login - Teacher login');
    console.log('  • POST /validate-wifi - WiFi validation');
    console.log('  • POST /attendance/mark - Mark attendance');
    console.log('\n🖥️  Admin Panel Endpoints:');
    console.log('  • POST /admin/sync/rooms - Sync rooms');
    console.log('  • POST /admin/sync/students - Sync students');
    console.log('  • POST /admin/sync/teachers - Sync teachers');
    console.log('  • GET /admin/sessions - View active sessions');
    console.log('\n🔐 Demo Credentials:');
    console.log('  👨‍🎓 Student: S11111111 / student123');
    console.log('  👨‍🏫 Teacher: T12345678 / teacher123');
    console.log('\n💾 Database: In-Memory (Perfect for Render)');
    console.log(`📊 Initial Data: ${rooms.length} rooms, ${students.length} students, ${teachers.length} teachers`);
    console.log('\n✅ Server ready for connections!');
    console.log('='.repeat(50));
});
