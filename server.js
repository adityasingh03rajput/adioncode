const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// The allowed BSSID
const ALLOWED_BSSID = '6a:5e:31:58:9b:61';

// Endpoint to validate BSSID
app.post('/validate-wifi', (req, res) => {
    const { bssid } = req.body;
    
    console.log(`Received BSSID validation request: ${bssid}`);
    
    if (!bssid) {
        return res.status(400).json({
            success: false,
            message: 'BSSID is required'
        });
    }
    
    // Check if the BSSID matches the allowed one
    const isValid = bssid.toLowerCase() === ALLOWED_BSSID.toLowerCase();
    
    if (isValid) {
        console.log(`✅ BSSID ${bssid} is ALLOWED - Timer can run`);
        res.json({
            success: true,
            message: 'WiFi network is authorized for timer usage',
            allowedBssid: ALLOWED_BSSID
        });
    } else {
        console.log(`❌ BSSID ${bssid} is NOT ALLOWED - Timer blocked`);
        res.json({
            success: false,
            message: 'This WiFi network is not authorized for timer usage',
            allowedBssid: ALLOWED_BSSID
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'Server is running',
        allowedBssid: ALLOWED_BSSID,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Let's Bunk Server running on port ${PORT}`);
    console.log(`📶 Allowed BSSID: ${ALLOWED_BSSID}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 Validate endpoint: http://localhost:${PORT}/validate-wifi`);
});
