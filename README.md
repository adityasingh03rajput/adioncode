# INTROVERT - Anonymous Social Platform

🚀 **Next-Generation Anonymous Social Connection Platform**

INTROVERT is a modern, AI-powered anonymous social platform that enables genuine connections without the pressure of identity. Built with cutting-edge web technologies, it provides a safe space for authentic conversations, creative collaboration, and meaningful human connections.

## ✨ Features

### 🤖 AI-Powered Features
- **Smart Replies**: Intelligent conversation suggestions powered by advanced AI
- **Real-time Translation**: Break language barriers with instant message translation
- **Content Moderation**: AI-powered filtering for a safe environment

### 🎯 Social Features
- **Anonymous Chatting**: Complete privacy protection
- **Random Matching**: Connect with strangers based on preferences
- **Private Rooms**: Create custom chat rooms
- **Real-time Messaging**: Instant communication with typing indicators

### 🎬 Entertainment Features
- **Watch Parties**: Sync videos and chat while watching together
- **Collaborative Canvas**: Draw and create together in real-time
- **Voice & Video Calls**: WebRTC-powered communication

### 🔒 Security & Privacy
- **JWT Authentication**: Secure token-based authentication
- **Password Encryption**: bcrypt hashing for password security
- **Rate Limiting**: Protection against spam and abuse
- **Content Sanitization**: XSS protection and input validation

## 🛠️ Technology Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **JWT** - Authentication
- **bcryptjs** - Password hashing
- **Helmet** - Security headers
- **CORS** - Cross-origin resource sharing

### Frontend
- **HTML5** - Modern markup
- **CSS3** - Advanced styling with custom properties
- **JavaScript ES6+** - Modern client-side scripting
- **Socket.IO Client** - Real-time communication
- **Font Awesome** - Icons
- **Google Fonts** - Typography

### Features
- **Responsive Design** - Mobile-first approach
- **Dark Theme** - Modern UI/UX
- **Real-time Updates** - Live messaging and notifications
- **Progressive Enhancement** - Works without JavaScript

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/adioncode/introvert-platform.git
   cd introvert-platform
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set environment variables**
   ```bash
   # Create .env file (optional)
   PORT=3000
   JWT_SECRET=your-secret-key
   NODE_ENV=production
   ```

4. **Start the server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

5. **Access the application**
   - Local: http://localhost:3000
   - Production: https://google-8j5x.onrender.com

## 📱 Usage

### Getting Started
1. **Visit the platform** - Open the website in your browser
2. **Register/Login** - Create an account or sign in
3. **Start Chatting** - Find random matches or create rooms
4. **Explore Features** - Try AI replies, translation, and more

### Key Functions
- **Random Match**: Click "Random Match" to connect with strangers
- **Smart Replies**: Use AI-powered conversation suggestions
- **Translation**: Translate messages in real-time
- **Watch Party**: Sync videos with friends
- **Canvas**: Collaborate on digital artwork

## 🏗️ Project Structure

```
introvert-platform/
├── server.js          # Main server file
├── index.html         # Frontend application
├── package.json       # Dependencies and scripts
├── README.md          # Project documentation
└── .env              # Environment variables (optional)
```

## 🔧 Configuration

### Server Configuration
The server automatically configures itself with sensible defaults:
- **Port**: 3000 (or from environment)
- **CORS**: Configured for production domain
- **Security**: Helmet, rate limiting, input sanitization
- **Authentication**: JWT with 30-day expiration

### Client Configuration
The frontend automatically connects to the server and handles:
- **Socket.IO**: Real-time communication
- **Authentication**: Token-based auth with localStorage
- **Responsive Design**: Mobile-first approach
- **Error Handling**: User-friendly error messages

## 🚀 Deployment

### Render.com (Recommended)
1. Connect your GitHub repository
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Deploy automatically

### Manual Deployment
1. Build the application: `npm install`
2. Start the server: `npm start`
3. Configure reverse proxy (nginx/Apache)
4. Set up SSL certificate

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Socket.IO** - Real-time communication
- **Express.js** - Web framework
- **Font Awesome** - Icons
- **Google Fonts** - Typography
- **Render.com** - Hosting platform

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/adioncode/introvert-platform/issues)
- **Discussions**: [GitHub Discussions](https://github.com/adioncode/introvert-platform/discussions)
- **Email**: support@introvert-platform.com

---

**Built with ❤️ by the INTROVERT Team**

*Connecting people, protecting privacy, powered by AI.*