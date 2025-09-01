const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for device timers and BSSID management
let deviceTimers = new Map();
// Support multiple authorized BSSIDs
let authorizedBSSIDs = ['2a:d0:43:d1:34:bf']; // Array of authorized BSSIDs
let bssidHistory = []; // Store BSSID change history

// Device timer states
const TIMER_STATES = {
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    STOPPED: 'stopped'
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: process.uptime(),
        activeDevices: deviceTimers.size
    });
});

// Start timer for a device
app.post('/api/timer/start', (req, res) => {
    try {
        const { deviceId, bssid, studentName } = req.body;

        console.log(`🟢 Timer START request: Device ${deviceId} at BSSID ${bssid}, Student: ${studentName || 'Anonymous'}`);

        // Validate required BSSID (check against multiple authorized BSSIDs)
        if (!authorizedBSSIDs.includes(bssid)) {
            return res.status(403).json({
                success: false,
                message: `Timer can only be started on authorized networks: ${authorizedBSSIDs.join(', ')}`
            });
        }

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required'
            });
        }

        // Create or update timer entry with student name
        const timerData = {
            deviceId: deviceId,
            bssid: bssid,
            studentName: studentName || 'Anonymous',
            state: TIMER_STATES.RUNNING,
            startTime: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            totalDuration: 0,
            pausedDuration: 0
        };

        deviceTimers.set(deviceId, timerData);

        console.log(`✅ Timer started for device: ${deviceId}, Student: ${timerData.studentName}`);

        res.json({
            success: true,
            message: `Timer started successfully for ${timerData.studentName}`,
            deviceId: deviceId,
            studentName: timerData.studentName,
            state: TIMER_STATES.RUNNING,
            startTime: timerData.startTime
        });

    } catch (error) {
        console.error('Timer start error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Pause timer for a device
app.post('/api/timer/pause', (req, res) => {
    try {
        const { deviceId } = req.body;

        console.log(`⏸️ Timer PAUSE request: Device ${deviceId}`);

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required'
            });
        }

        const timerData = deviceTimers.get(deviceId);
        if (!timerData) {
            return res.status(404).json({
                success: false,
                message: 'Timer not found for this device'
            });
        }

        // Update timer state
        timerData.state = TIMER_STATES.PAUSED;
        timerData.lastUpdate = new Date().toISOString();

        deviceTimers.set(deviceId, timerData);

        console.log(`⏸️ Timer paused for device: ${deviceId}`);

        res.json({
            success: true,
            message: 'Timer paused successfully',
            deviceId: deviceId,
            state: TIMER_STATES.PAUSED
        });

    } catch (error) {
        console.error('Timer pause error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Resume timer for a device
app.post('/api/timer/resume', (req, res) => {
    try {
        const { deviceId } = req.body;

        console.log(`▶️ Timer RESUME request: Device ${deviceId}`);

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required'
            });
        }

        const timerData = deviceTimers.get(deviceId);
        if (!timerData) {
            return res.status(404).json({
                success: false,
                message: 'Timer not found for this device'
            });
        }

        // Update timer state
        timerData.state = TIMER_STATES.RUNNING;
        timerData.lastUpdate = new Date().toISOString();

        deviceTimers.set(deviceId, timerData);

        console.log(`▶️ Timer resumed for device: ${deviceId}`);

        res.json({
            success: true,
            message: 'Timer resumed successfully',
            deviceId: deviceId,
            state: TIMER_STATES.RUNNING
        });

    } catch (error) {
        console.error('Timer resume error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Stop/Complete timer for a device
app.post('/api/timer/stop', (req, res) => {
    try {
        const { deviceId, duration } = req.body;

        console.log(`🛑 Timer STOP request: Device ${deviceId}, Duration: ${duration}`);

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required'
            });
        }

        const timerData = deviceTimers.get(deviceId);
        if (!timerData) {
            return res.status(404).json({
                success: false,
                message: 'Timer not found for this device'
            });
        }

        // Update timer state
        timerData.state = TIMER_STATES.COMPLETED;
        timerData.lastUpdate = new Date().toISOString();
        timerData.totalDuration = duration || 0;
        timerData.endTime = new Date().toISOString();

        deviceTimers.set(deviceId, timerData);

        console.log(`🛑 Timer completed for device: ${deviceId}, Duration: ${duration} seconds`);

        res.json({
            success: true,
            message: 'Timer completed successfully',
            deviceId: deviceId,
            state: TIMER_STATES.COMPLETED,
            totalDuration: timerData.totalDuration
        });

    } catch (error) {
        console.error('Timer stop error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Update timer status (heartbeat)
app.post('/api/timer/update', (req, res) => {
    try {
        const { deviceId, duration, state } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required'
            });
        }

        const timerData = deviceTimers.get(deviceId);
        if (!timerData) {
            return res.status(404).json({
                success: false,
                message: 'Timer not found for this device'
            });
        }

        // Update timer data
        timerData.lastUpdate = new Date().toISOString();
        if (duration !== undefined) timerData.totalDuration = duration;
        if (state) timerData.state = state;

        deviceTimers.set(deviceId, timerData);

        res.json({
            success: true,
            message: 'Timer updated successfully',
            deviceId: deviceId
        });

    } catch (error) {
        console.error('Timer update error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Get all active timers (for teacher dashboard)
app.get('/api/timers/all', (req, res) => {
    try {
        console.log(`📊 All timers request - Total devices: ${deviceTimers.size}`);

        const allTimers = Array.from(deviceTimers.values()).map(timer => ({
            deviceId: timer.deviceId,
            studentName: timer.studentName || 'Anonymous',
            state: timer.state,
            startTime: timer.startTime,
            lastUpdate: timer.lastUpdate,
            totalDuration: timer.totalDuration,
            bssid: timer.bssid,
            endTime: timer.endTime || null
        }));

        // Group by state for easy dashboard display
        const timersByState = {
            running: allTimers.filter(t => t.state === TIMER_STATES.RUNNING),
            paused: allTimers.filter(t => t.state === TIMER_STATES.PAUSED),
            completed: allTimers.filter(t => t.state === TIMER_STATES.COMPLETED),
            total: allTimers.length
        };

        // Log student names for debugging
        const studentNames = allTimers.map(t => `${t.studentName} (${t.state})`).join(', ');
        console.log(`👥 Active students: ${studentNames || 'None'}`);

        res.json({
            success: true,
            timers: allTimers,
            summary: timersByState,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Get all timers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Get timer status for specific device
app.get('/api/timer/:deviceId', (req, res) => {
    try {
        const { deviceId } = req.params;

        const timerData = deviceTimers.get(deviceId);
        if (!timerData) {
            return res.status(404).json({
                success: false,
                message: 'Timer not found for this device'
            });
        }

        res.json({
            success: true,
            timer: {
                deviceId: timerData.deviceId,
                studentName: timerData.studentName || 'Anonymous',
                state: timerData.state,
                startTime: timerData.startTime,
                lastUpdate: timerData.lastUpdate,
                totalDuration: timerData.totalDuration,
                bssid: timerData.bssid,
                endTime: timerData.endTime || null
            }
        });

    } catch (error) {
        console.error('Get timer error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Clear completed timers (cleanup endpoint)
app.delete('/api/timers/cleanup', (req, res) => {
    try {
        const beforeCount = deviceTimers.size;

        // Remove completed timers older than 24 hours
        const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

        for (const [deviceId, timer] of deviceTimers.entries()) {
            if (timer.state === TIMER_STATES.COMPLETED &&
                new Date(timer.lastUpdate) < cutoffTime) {
                deviceTimers.delete(deviceId);
            }
        }

        const afterCount = deviceTimers.size;
        const cleanedCount = beforeCount - afterCount;

        console.log(`🧹 Cleanup completed: Removed ${cleanedCount} old timers`);

        res.json({
            success: true,
            message: `Cleanup completed: Removed ${cleanedCount} old timers`,
            remainingTimers: afterCount
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Clear all completed timers (for teacher dashboard)
app.post('/api/timers/clear-completed', (req, res) => {
    try {
        const beforeCount = deviceTimers.size;
        const completedTimers = [];

        // Remove all completed timers
        for (const [deviceId, timer] of deviceTimers.entries()) {
            if (timer.state === TIMER_STATES.COMPLETED) {
                completedTimers.push(`${timer.studentName || 'Anonymous'} (${timer.deviceId})`);
                deviceTimers.delete(deviceId);
            }
        }

        const afterCount = deviceTimers.size;
        const cleanedCount = beforeCount - afterCount;

        console.log(`🧹 Teacher cleared ${cleanedCount} completed timers: ${completedTimers.join(', ')}`);

        res.json({
            success: true,
            message: `Cleared ${cleanedCount} completed timers`,
            clearedTimers: completedTimers,
            remainingTimers: afterCount
        });

    } catch (error) {
        console.error('Clear completed timers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// BSSID Management Endpoints

// Get current authorized BSSID
app.get('/api/bssid/current', (req, res) => {
    try {
        console.log(`📡 BSSID request - Current authorized BSSIDs: ${authorizedBSSIDs.join(', ')}`);

        res.json({
            success: true,
            bssids: authorizedBSSIDs,
            primaryBSSID: authorizedBSSIDs[0], // For backward compatibility
            bssid: authorizedBSSIDs[0], // For backward compatibility
            count: authorizedBSSIDs.length,
            timestamp: new Date().toISOString(),
            message: 'Current authorized BSSIDs retrieved successfully'
        });

    } catch (error) {
        console.error('Get BSSID error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Update authorized BSSID
app.post('/api/bssid/update', (req, res) => {
    try {
        const { bssid, description, updatedBy } = req.body;

        console.log(`👑 BSSID UPDATE request: ${bssid} by ${updatedBy || 'Unknown'}`);

        if (!bssid) {
            return res.status(400).json({
                success: false,
                message: 'BSSID is required'
            });
        }

        // Validate BSSID format (basic MAC address validation)
        const bssidRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
        if (!bssidRegex.test(bssid)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid BSSID format. Use MAC address format (XX:XX:XX:XX:XX:XX)'
            });
        }

        // Store old BSSIDs for history
        const oldBSSIDs = [...authorizedBSSIDs];

        // Update primary BSSID (replace first one or add if not exists)
        if (authorizedBSSIDs.length > 0) {
            authorizedBSSIDs[0] = bssid;
        } else {
            authorizedBSSIDs.push(bssid);
        }

        // Add to history
        const historyEntry = {
            oldBSSIDs: oldBSSIDs,
            newBSSIDs: [...authorizedBSSIDs],
            action: 'update_primary',
            description: description || 'Primary BSSID updated via API',
            updatedBy: updatedBy || 'API',
            timestamp: new Date().toISOString()
        };

        bssidHistory.push(historyEntry);

        // Keep only last 100 history entries
        if (bssidHistory.length > 100) {
            bssidHistory = bssidHistory.slice(-100);
        }

        console.log(`✅ Primary BSSID updated: ${oldBSSIDs[0]} → ${bssid}`);

        res.json({
            success: true,
            message: 'Primary BSSID updated successfully',
            oldBSSIDs: oldBSSIDs,
            newBSSIDs: [...authorizedBSSIDs],
            primaryBSSID: bssid,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Update BSSID error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Get BSSID change history
app.get('/api/bssid/history', (req, res) => {
    try {
        console.log(`📋 BSSID history request - ${bssidHistory.length} entries`);

        res.json({
            success: true,
            history: bssidHistory,
            currentBSSIDs: authorizedBSSIDs,
            primaryBSSID: authorizedBSSIDs[0],
            totalEntries: bssidHistory.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Get BSSID history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Add new authorized BSSID
app.post('/api/bssid/add', (req, res) => {
    try {
        const { bssid, description, updatedBy } = req.body;

        console.log(`➕ BSSID ADD request: ${bssid} by ${updatedBy || 'Unknown'}`);

        if (!bssid) {
            return res.status(400).json({
                success: false,
                message: 'BSSID is required'
            });
        }

        // Validate BSSID format
        const bssidRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
        if (!bssidRegex.test(bssid)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid BSSID format. Use MAC address format (XX:XX:XX:XX:XX:XX)'
            });
        }

        // Check if BSSID already exists
        if (authorizedBSSIDs.includes(bssid)) {
            return res.status(400).json({
                success: false,
                message: 'BSSID already authorized'
            });
        }

        // Add new BSSID
        const oldBSSIDs = [...authorizedBSSIDs];
        authorizedBSSIDs.push(bssid);

        // Add to history
        const historyEntry = {
            oldBSSIDs: oldBSSIDs,
            newBSSIDs: [...authorizedBSSIDs],
            action: 'add',
            addedBSSID: bssid,
            description: description || 'New BSSID added via API',
            updatedBy: updatedBy || 'API',
            timestamp: new Date().toISOString()
        };

        bssidHistory.push(historyEntry);

        // Keep only last 100 history entries
        if (bssidHistory.length > 100) {
            bssidHistory = bssidHistory.slice(-100);
        }

        console.log(`✅ BSSID added: ${bssid} (Total: ${authorizedBSSIDs.length})`);

        res.json({
            success: true,
            message: 'BSSID added successfully',
            addedBSSID: bssid,
            authorizedBSSIDs: [...authorizedBSSIDs],
            totalCount: authorizedBSSIDs.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Add BSSID error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Remove authorized BSSID
app.post('/api/bssid/remove', (req, res) => {
    try {
        const { bssid, description, updatedBy } = req.body;

        console.log(`➖ BSSID REMOVE request: ${bssid} by ${updatedBy || 'Unknown'}`);

        if (!bssid) {
            return res.status(400).json({
                success: false,
                message: 'BSSID is required'
            });
        }

        // Check if BSSID exists
        if (!authorizedBSSIDs.includes(bssid)) {
            return res.status(400).json({
                success: false,
                message: 'BSSID not found in authorized list'
            });
        }

        // Prevent removing the last BSSID
        if (authorizedBSSIDs.length === 1) {
            return res.status(400).json({
                success: false,
                message: 'Cannot remove the last authorized BSSID'
            });
        }

        // Remove BSSID
        const oldBSSIDs = [...authorizedBSSIDs];
        authorizedBSSIDs = authorizedBSSIDs.filter(b => b !== bssid);

        // Add to history
        const historyEntry = {
            oldBSSIDs: oldBSSIDs,
            newBSSIDs: [...authorizedBSSIDs],
            action: 'remove',
            removedBSSID: bssid,
            description: description || 'BSSID removed via API',
            updatedBy: updatedBy || 'API',
            timestamp: new Date().toISOString()
        };

        bssidHistory.push(historyEntry);

        // Keep only last 100 history entries
        if (bssidHistory.length > 100) {
            bssidHistory = bssidHistory.slice(-100);
        }

        console.log(`✅ BSSID removed: ${bssid} (Remaining: ${authorizedBSSIDs.length})`);

        res.json({
            success: true,
            message: 'BSSID removed successfully',
            removedBSSID: bssid,
            authorizedBSSIDs: [...authorizedBSSIDs],
            totalCount: authorizedBSSIDs.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Remove BSSID error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Get all authorized BSSIDs
app.get('/api/bssid/all', (req, res) => {
    try {
        console.log(`📡 All BSSIDs request - ${authorizedBSSIDs.length} authorized BSSIDs`);

        res.json({
            success: true,
            bssids: authorizedBSSIDs,
            primaryBSSID: authorizedBSSIDs[0],
            count: authorizedBSSIDs.length,
            timestamp: new Date().toISOString(),
            message: 'All authorized BSSIDs retrieved successfully'
        });

    } catch (error) {
        console.error('Get all BSSIDs error:', error);
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

// Auto-cleanup every hour
setInterval(() => {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [deviceId, timer] of deviceTimers.entries()) {
        if (timer.state === TIMER_STATES.COMPLETED &&
            new Date(timer.lastUpdate) < cutoffTime) {
            deviceTimers.delete(deviceId);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`🧹 Auto-cleanup: Removed ${cleanedCount} old timers`);
    }
}, 60 * 60 * 1000); // Every hour

app.listen(PORT, () => {
    console.log(`� LettsBunk Royal Server running on port ${PORT}`);
    console.log(`📊 Timer tracking system with student names ready`);
    console.log(`🌐 Authorized BSSIDs (${authorizedBSSIDs.length}): ${authorizedBSSIDs.join(', ')}`);
    console.log(`🎨 Royal Olive & Sand Brown Theme Support`);
    console.log(`📱 API Endpoints available:`);
    console.log(`   POST /api/timer/start - Start timer (with student name)`);
    console.log(`   POST /api/timer/pause - Pause timer`);
    console.log(`   POST /api/timer/resume - Resume timer`);
    console.log(`   POST /api/timer/stop - Stop timer`);
    console.log(`   POST /api/timer/update - Update timer (heartbeat)`);
    console.log(`   GET /api/timers/all - Get all timers (for teacher dashboard)`);
    console.log(`   GET /api/timer/:deviceId - Get specific timer`);
    console.log(`   POST /api/timers/clear-completed - Clear completed timers`);
    console.log(`   DELETE /api/timers/cleanup - Auto cleanup old timers`);
    console.log(`   GET /api/bssid/current - Get current authorized BSSIDs`);
    console.log(`   GET /api/bssid/all - Get all authorized BSSIDs`);
    console.log(`   POST /api/bssid/update - Update primary BSSID`);
    console.log(`   POST /api/bssid/add - Add new authorized BSSID`);
    console.log(`   POST /api/bssid/remove - Remove authorized BSSID`);
    console.log(`   GET /api/bssid/history - Get BSSID change history`);
    console.log(`   GET /health - Health check`);
    console.log(`👥 Student name tracking enabled`);
    console.log(`🔄 Auto-cleanup every hour for old completed timers`);
});
