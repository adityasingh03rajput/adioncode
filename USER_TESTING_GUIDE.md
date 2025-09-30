# 🧪 INTROVERT - Complete User Testing Guide

## 🎯 How to Test Every Feature

### **Prerequisites**
- Open: https://google-8j5x.onrender.com (or open index.html locally)
- Have 2 browser windows/tabs for testing real-time features
- Allow camera/microphone permissions for video/voice calls

---

## 📝 Step-by-Step Testing Guide

### **1. Authentication Flow**

#### Test Registration
1. Click "Join Now" button in header
2. Fill in registration form:
   - Username: testuser1
   - Email: test1@example.com
   - Password: password123
   - Age: 25
   - Gender: Male
3. Click "Register"
4. ✅ **Expected**: 
   - Modal closes
   - Login/Register buttons disappear
   - User greeting appears: "Hello, testuser1"
   - Dashboard link appears in nav
   - Redirected to chat page

#### Test Login
1. Logout (click logout button)
2. Click "Login" button
3. Enter credentials
4. Click "Login"
5. ✅ **Expected**: Same as registration

#### Test Auth Persistence
1. Login
2. Refresh page (F5)
3. ✅ **Expected**: Still logged in, UI shows authenticated state

---

### **2. Navigation Testing**

#### Test Home Button
1. While logged in, click "Home" in nav
2. ✅ **Expected**: Shows home page, still logged in (no logout)

#### Test Dashboard Link
1. Click "Dashboard" in nav
2. ✅ **Expected**: Shows chat page with all sections

#### Test Section Switching
1. In dashboard, click each tab:
   - Chat
   - Posts
   - Search
   - Notifications
   - Profile
   - Matching
2. ✅ **Expected**: Each section displays correctly

---

### **3. Posts System Testing**

#### Create Post with Image
1. Go to Posts section
2. Click "New Post" button
3. Enter content: "This is my first post!"
4. Upload an image
5. Add caption: "Beautiful day"
6. Click "Share Post"
7. ✅ **Expected**: 
   - Modal closes
   - Post appears in feed
   - Image is displayed
   - Success notification

#### Create Text-Only Post
1. Click "New Post"
2. Enter only content (no image)
3. Click "Share Post"
4. ✅ **Expected**: Post appears in feed

#### Like a Post
1. Click heart icon on any post
2. ✅ **Expected**: 
   - Heart turns red/active
   - Like count increases
   - Can unlike by clicking again

#### Comment on Post
1. Click "Comment" button on post
2. Comment section expands
3. Type comment: "Great post!"
4. Click "Post" button
5. ✅ **Expected**: 
   - Comment appears
   - Comment count increases

#### Load More Posts
1. Scroll to bottom of feed
2. Click "Load More" button
3. ✅ **Expected**: More posts load

---

### **4. Search Features Testing**

#### Username Search
1. Go to Search section
2. Enter username in search box
3. Click "Search"
4. ✅ **Expected**: 
   - Matching users displayed
   - Can click "View" or "Follow"

#### Face Recognition Search
1. Click "Search by face" tab
2. Upload a face image
3. Click "Find Matches"
4. ✅ **Expected**: 
   - Matching profiles with confidence scores
   - Top 5 results shown

#### Follow User from Search
1. Search for a user
2. Click "Follow" button
3. ✅ **Expected**: 
   - "Follow request sent" message
   - Button changes state

---

### **5. Follow System Testing**

#### Send Follow Request
1. Search for user
2. Click "Follow"
3. ✅ **Expected**: Request sent notification

#### Accept Follow Request (Need 2 accounts)
1. User A follows User B
2. Login as User B
3. Go to Matching section
4. Click "Refresh" in Follow Requests
5. See User A's request
6. Click "Accept"
7. ✅ **Expected**: 
   - Request disappears
   - Follower count increases

#### Reject Follow Request
1. Click "Reject" on a request
2. ✅ **Expected**: Request disappears

---

### **6. Notifications Testing**

#### View Notifications
1. Go to Notifications section
2. ✅ **Expected**: 
   - List of notifications (likes, comments, follows, badges)
   - Newest first

#### Mark All as Read
1. Click "Mark all read" button
2. ✅ **Expected**: All notifications marked as read

#### Real-time Notification (Need 2 accounts)
1. User A likes User B's post
2. User B should see notification instantly
3. ✅ **Expected**: Real-time notification appears

---

### **7. Profile Management Testing**

#### View Profile Stats
1. Go to Profile section
2. ✅ **Expected**: 
   - Posts count
   - Followers count
   - Following count
   - Badges displayed

#### Edit Profile
1. Enter bio: "I love coding!"
2. Enter interests: "music, travel, coding"
3. Click "Save Changes"
4. ✅ **Expected**: 
   - Success message
   - Profile updated

#### Upload Profile Picture
1. Click "Choose File"
2. Select image
3. Click "Upload"
4. ✅ **Expected**: 
   - Success message
   - Profile picture updated

---

### **8. Random Matching Testing**

#### Basic Random Match
1. Click "Random Match" button on home page
2. ✅ **Expected**: 
   - Finds available user
   - Creates chat room
   - Shows "Chatting with [username]"

#### Enhanced Match with Preferences
1. Go to Matching section
2. Select gender preference
3. Click "Start"
4. ✅ **Expected**: 
   - Finds match based on preference
   - Shows match details
   - "Chat" button available

---

### **9. Real-time Chat Testing** (Need 2 accounts)

#### Send Messages
1. User A and User B in same room
2. User A types message
3. Press Enter or click Send
4. ✅ **Expected**: 
   - Message appears for both users
   - Real-time delivery

#### Typing Indicators
1. User A starts typing
2. ✅ **Expected**: User B sees "User A is typing..."

#### AI Smart Replies
1. Receive a message
2. Click AI button (robot icon)
3. ✅ **Expected**: 
   - 5 smart reply suggestions
   - Click to use suggestion

---

### **10. Watch Party Testing** (Need 2 accounts in same room)

#### Start Watch Party
1. Join a chat room
2. Click "Watch Party" button
3. Paste YouTube URL: https://youtube.com/watch?v=dQw4w9WgXcQ
4. Click "Load Video"
5. ✅ **Expected**: 
   - Video player appears
   - Both users see the same video
   - Video synced

---

### **11. Collaborative Canvas Testing** (Need 2 accounts in same room)

#### Draw on Canvas
1. Join a chat room
2. Click "Collaborative Canvas"
3. Select a color
4. Draw on canvas
5. ✅ **Expected**: 
   - Both users see the drawing in real-time
   - Colors sync correctly

#### Clear Canvas
1. Click "Clear" button
2. ✅ **Expected**: 
   - Canvas clears for both users

---

### **12. Translation Testing**

#### Translate Message
1. Have some messages in chat
2. Click "Translate" button
3. Select target language (e.g., Spanish)
4. Click "Translate"
5. ✅ **Expected**: 
   - Original message shown
   - Translated message displayed

---

### **13. Video Call Testing** (Need 2 accounts in same room)

#### Start Video Call
1. Join a chat room
2. Click "Video Call" button
3. Allow camera/microphone access
4. ✅ **Expected**: 
   - Local video appears
   - Partner receives call
   - Remote video appears
   - Both can see/hear each other

#### Call Controls
1. Click "Mute" button
2. ✅ **Expected**: Audio muted
3. Click "Stop Video" button
4. ✅ **Expected**: Video stops
5. Click "End Call"
6. ✅ **Expected**: Call ends, streams stop

---

### **14. Voice Call Testing** (Need 2 accounts in same room)

#### Start Voice Call
1. Join a chat room
2. Click "Voice Call" button
3. Allow microphone access
4. ✅ **Expected**: 
   - Audio connection established
   - Can hear each other
   - No video streams

---

### **15. Badge System Testing**

#### Earn Badges
1. Complete random matches
2. Follow users from matches
3. Accumulate follows:
   - 25 follows = Bronze badge
   - 50 follows = Silver badge
   - 100 follows = Gold badge
4. ✅ **Expected**: 
   - Badge notification
   - Badge appears in profile

---

## 🐛 Common Issues & Solutions

### Issue: "No matches found"
**Solution**: Need at least 2 users online. Open 2 browser windows.

### Issue: Video call not working
**Solution**: 
- Allow camera/microphone permissions
- Check if another app is using camera
- Try in Chrome/Edge (best WebRTC support)

### Issue: Images not uploading
**Solution**: 
- Check file size (max 10MB)
- Ensure image format (jpg, png, gif)
- Check server is running

### Issue: Real-time features not working
**Solution**: 
- Check Socket.IO connection
- Look for "Connected to server" in console
- Refresh page

### Issue: "Invalid token" error
**Solution**: 
- Logout and login again
- Clear localStorage
- Re-register

---

## ✅ Feature Completion Checklist

Use this checklist to verify all features:

### Authentication
- [ ] Register new user
- [ ] Login existing user
- [ ] Logout
- [ ] Auth persistence on refresh
- [ ] UI updates on auth state

### Navigation
- [ ] Home button (no logout)
- [ ] Dashboard link
- [ ] Section switching
- [ ] Modal opening/closing

### Posts
- [ ] Create post with image
- [ ] Create text-only post
- [ ] Like post
- [ ] Unlike post
- [ ] Comment on post
- [ ] Load more posts
- [ ] View full-size image

### Search
- [ ] Search by username
- [ ] Search by bio
- [ ] Face recognition search
- [ ] Follow from search results

### Follow System
- [ ] Send follow request
- [ ] Accept follow request
- [ ] Reject follow request
- [ ] View followers
- [ ] View following
- [ ] Unfollow user

### Notifications
- [ ] View notifications
- [ ] Mark single as read
- [ ] Mark all as read
- [ ] Delete notification
- [ ] Real-time push

### Profile
- [ ] View profile stats
- [ ] Edit bio
- [ ] Edit interests
- [ ] Upload profile picture
- [ ] View badges

### Matching
- [ ] Basic random match
- [ ] Enhanced match with preferences
- [ ] Follow from match

### Chat
- [ ] Send messages
- [ ] Receive messages
- [ ] Typing indicators
- [ ] AI smart replies
- [ ] Join room
- [ ] Create room

### Watch Party
- [ ] Start watch party
- [ ] Load YouTube video
- [ ] Video sync across users

### Canvas
- [ ] Open canvas
- [ ] Draw with different colors
- [ ] Real-time sync
- [ ] Clear canvas

### Translation
- [ ] Translate last message
- [ ] Multiple languages
- [ ] Display translation

### Video/Voice Calls
- [ ] Start video call
- [ ] Start voice call
- [ ] Mute/unmute
- [ ] Enable/disable video
- [ ] End call
- [ ] WebRTC connection

### Badges
- [ ] Earn bronze badge
- [ ] Earn silver badge
- [ ] Earn gold badge
- [ ] Badge notification

---

## 📊 Performance Testing

### Load Testing
1. Create 10+ posts
2. Load feed
3. ✅ **Expected**: Loads within 2 seconds

### Real-time Latency
1. Send message
2. Measure time to receive
3. ✅ **Expected**: < 100ms latency

### Image Upload
1. Upload 5MB image
2. ✅ **Expected**: Uploads and processes within 5 seconds

---

## 🎉 Success Criteria

All features are working if:
- ✅ All checkboxes above are checked
- ✅ No console errors
- ✅ Real-time features sync instantly
- ✅ UI is responsive and smooth
- ✅ All buttons work as expected
- ✅ Modals open and close properly
- ✅ Authentication persists
- ✅ Images load correctly
- ✅ Video/voice calls connect

---

## 📞 Support

If you encounter any issues:
1. Check browser console for errors
2. Verify server is running: https://google-8j5x.onrender.com/health
3. Clear cache and cookies
4. Try in incognito mode
5. Check documentation files

**Everything should work perfectly from A to Z!** 🚀
