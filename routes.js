import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import fs from 'fs/promises';

// This file contains all the missing route handlers for the social media features
// These need to be integrated into the main server.js file

export class SocialRoutes {
    constructor(server) {
        this.server = server;
        this.users = server.users;
        this.posts = server.posts;
        this.comments = server.comments;
        this.likes = server.likes;
        this.follows = server.follows;
        this.notifications = server.notifications;
        this.badges = server.badges;
        this.faceMatches = server.faceMatches;
        this.searchHistory = server.searchHistory;
        this.randomMatchQueue = server.randomMatchQueue;
        this.upload = server.upload;
    }

    // 📝 Posts Management
    async createPost(req, res) {
        try {
            this.upload.single('image')(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ error: err.message });
                }

                const { content, caption } = req.body;
                const user = req.user;

                if (!content && !req.file) {
                    return res.status(400).json({ error: 'Post must have content or image' });
                }

                const postId = uuidv4();
                let imageUrl = null;

                if (req.file) {
                    const processedImagePath = join(process.cwd(), 'uploads/posts', `processed-${req.file.filename}`);
                    await sharp(req.file.path)
                        .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 85 })
                        .toFile(processedImagePath);
                    
                    imageUrl = `/uploads/posts/processed-${req.file.filename}`;
                }

                const post = {
                    id: postId,
                    userId: user.id,
                    username: user.username,
                    content: content ? this.server.sanitize(content) : '',
                    caption: caption ? this.server.sanitize(caption) : '',
                    imageUrl,
                    likes: [],
                    comments: [],
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                this.posts.set(postId, post);
                user.posts.push(postId);
                user.stats.postsCount++;

                // Notify followers
                for (const followerId of user.followers) {
                    this.createNotification(followerId, 'new_post', {
                        userId: user.id,
                        username: user.username,
                        postId: postId,
                        message: `${user.username} shared a new post`
                    });
                }

                res.json({ success: true, post });
            });
        } catch (error) {
            this.server.logError('Error creating post:', error);
            res.status(500).json({ error: 'Failed to create post' });
        }
    }

    getFeed(req, res) {
        const user = req.user;
        const { page = 1, limit = 10 } = req.query;
        
        const followingIds = [...user.following, user.id];
        const allPosts = Array.from(this.posts.values())
            .filter(post => followingIds.includes(post.userId))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedPosts = allPosts.slice(startIndex, endIndex);

        res.json({
            success: true,
            posts: paginatedPosts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: allPosts.length,
                hasMore: endIndex < allPosts.length
            }
        });
    }

    getPost(req, res) {
        const { id } = req.params;
        const post = this.posts.get(id);

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        res.json({ success: true, post });
    }

    likePost(req, res) {
        const { id } = req.params;
        const user = req.user;
        const post = this.posts.get(id);

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const likeIndex = post.likes.indexOf(user.id);
        if (likeIndex > -1) {
            post.likes.splice(likeIndex, 1);
        } else {
            post.likes.push(user.id);
            
            if (post.userId !== user.id) {
                this.createNotification(post.userId, 'like', {
                    userId: user.id,
                    username: user.username,
                    postId: id,
                    message: `${user.username} liked your post`
                });
            }
        }

        res.json({ success: true, liked: likeIndex === -1, likesCount: post.likes.length });
    }

    commentPost(req, res) {
        const { id } = req.params;
        const { content } = req.body;
        const user = req.user;
        const post = this.posts.get(id);

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (!content || content.trim().length === 0) {
            return res.status(400).json({ error: 'Comment cannot be empty' });
        }

        const commentId = uuidv4();
        const comment = {
            id: commentId,
            postId: id,
            userId: user.id,
            username: user.username,
            content: this.server.sanitize(content.trim()),
            createdAt: new Date()
        };

        this.comments.set(commentId, comment);
        post.comments.push(commentId);

        if (post.userId !== user.id) {
            this.createNotification(post.userId, 'comment', {
                userId: user.id,
                username: user.username,
                postId: id,
                commentId: commentId,
                message: `${user.username} commented on your post`
            });
        }

        res.json({ success: true, comment });
    }

    deletePost(req, res) {
        const { id } = req.params;
        const user = req.user;
        const post = this.posts.get(id);

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (post.userId !== user.id) {
            return res.status(403).json({ error: 'Not authorized to delete this post' });
        }

        post.comments.forEach(commentId => {
            this.comments.delete(commentId);
        });

        const postIndex = user.posts.indexOf(id);
        if (postIndex > -1) {
            user.posts.splice(postIndex, 1);
            user.stats.postsCount--;
        }

        this.posts.delete(id);
        res.json({ success: true, message: 'Post deleted successfully' });
    }

    // 👥 Follow System
    followUser(req, res) {
        const { userId } = req.params;
        const currentUser = req.user;

        if (userId === currentUser.id) {
            return res.status(400).json({ error: 'Cannot follow yourself' });
        }

        const targetUser = this.users.get(userId);
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (currentUser.following.includes(userId)) {
            return res.status(400).json({ error: 'Already following this user' });
        }

        const followId = uuidv4();
        const followRequest = {
            id: followId,
            followerId: currentUser.id,
            followingId: userId,
            status: 'pending',
            createdAt: new Date()
        };

        this.follows.set(followId, followRequest);

        this.createNotification(userId, 'follow_request', {
            userId: currentUser.id,
            username: currentUser.username,
            followId: followId,
            message: `${currentUser.username} wants to follow you`
        });

        res.json({ success: true, message: 'Follow request sent' });
    }

    unfollowUser(req, res) {
        const { userId } = req.params;
        const currentUser = req.user;

        const followingIndex = currentUser.following.indexOf(userId);
        if (followingIndex === -1) {
            return res.status(400).json({ error: 'Not following this user' });
        }

        const targetUser = this.users.get(userId);
        if (targetUser) {
            const followerIndex = targetUser.followers.indexOf(currentUser.id);
            if (followerIndex > -1) {
                targetUser.followers.splice(followerIndex, 1);
                targetUser.stats.followersCount--;
            }
        }

        currentUser.following.splice(followingIndex, 1);
        currentUser.stats.followingCount--;

        res.json({ success: true, message: 'Unfollowed successfully' });
    }

    acceptFollowRequest(req, res) {
        const { userId } = req.params;
        const currentUser = req.user;

        let followRequest = null;
        for (const [id, request] of this.follows.entries()) {
            if (request.followerId === userId && request.followingId === currentUser.id && request.status === 'pending') {
                followRequest = request;
                break;
            }
        }

        if (!followRequest) {
            return res.status(404).json({ error: 'Follow request not found' });
        }

        const follower = this.users.get(userId);
        if (!follower) {
            return res.status(404).json({ error: 'User not found' });
        }

        followRequest.status = 'accepted';
        followRequest.acceptedAt = new Date();

        currentUser.followers.push(userId);
        currentUser.stats.followersCount++;

        follower.following.push(currentUser.id);
        follower.stats.followingCount++;

        if (followRequest.fromRandomMatch) {
            follower.stats.randomMatchFollows++;
            this.checkAndAwardBadges(follower);
        }

        this.createNotification(userId, 'follow_accepted', {
            userId: currentUser.id,
            username: currentUser.username,
            message: `${currentUser.username} accepted your follow request`
        });

        res.json({ success: true, message: 'Follow request accepted' });
    }

    rejectFollowRequest(req, res) {
        const { userId } = req.params;
        const currentUser = req.user;

        let followRequestId = null;
        for (const [id, request] of this.follows.entries()) {
            if (request.followerId === userId && request.followingId === currentUser.id && request.status === 'pending') {
                followRequestId = id;
                break;
            }
        }

        if (!followRequestId) {
            return res.status(404).json({ error: 'Follow request not found' });
        }

        this.follows.delete(followRequestId);
        res.json({ success: true, message: 'Follow request rejected' });
    }

    getFollowers(req, res) {
        const { userId } = req.params;
        const user = this.users.get(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const followers = user.followers.map(id => {
            const follower = this.users.get(id);
            return follower ? this.server.sanitizeUser(follower) : null;
        }).filter(Boolean);

        res.json({ success: true, followers });
    }

    getFollowing(req, res) {
        const { userId } = req.params;
        const user = this.users.get(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const following = user.following.map(id => {
            const followedUser = this.users.get(id);
            return followedUser ? this.server.sanitizeUser(followedUser) : null;
        }).filter(Boolean);

        res.json({ success: true, following });
    }

    // 🔍 Search Features
    searchUsers(req, res) {
        const { query, page = 1, limit = 10 } = req.query;
        const currentUser = req.user;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const searchTerm = query.toLowerCase().trim();
        
        if (!this.searchHistory.has(currentUser.id)) {
            this.searchHistory.set(currentUser.id, []);
        }
        const userSearchHistory = this.searchHistory.get(currentUser.id);
        if (!userSearchHistory.includes(searchTerm)) {
            userSearchHistory.unshift(searchTerm);
            if (userSearchHistory.length > 20) {
                userSearchHistory.pop();
            }
        }

        const matchingUsers = Array.from(this.users.values())
            .filter(user => 
                user.id !== currentUser.id &&
                user.searchable &&
                (user.username.toLowerCase().includes(searchTerm) ||
                 user.bio.toLowerCase().includes(searchTerm))
            )
            .map(user => this.server.sanitizeUser(user));

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedResults = matchingUsers.slice(startIndex, endIndex);

        res.json({
            success: true,
            users: paginatedResults,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: matchingUsers.length,
                hasMore: endIndex < matchingUsers.length
            }
        });
    }

    async searchByFace(req, res) {
        try {
            this.upload.single('image')(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ error: err.message });
                }

                if (!req.file) {
                    return res.status(400).json({ error: 'Image is required for face search' });
                }

                const currentUser = req.user;
                
                // Simulate face detection and matching
                const potentialMatches = Array.from(this.users.values())
                    .filter(user => 
                        user.id !== currentUser.id &&
                        user.profilePicture &&
                        user.searchable
                    )
                    .map(user => ({
                        ...this.server.sanitizeUser(user),
                        matchConfidence: Math.random() * 0.5 + 0.5
                    }))
                    .sort((a, b) => b.matchConfidence - a.matchConfidence)
                    .slice(0, 5);

                res.json({
                    success: true,
                    matches: potentialMatches,
                    message: 'Face search completed'
                });
            });
        } catch (error) {
            this.server.logError('Error in face search:', error);
            res.status(500).json({ error: 'Face search failed' });
        }
    }

    getSearchHistory(req, res) {
        const currentUser = req.user;
        const history = this.searchHistory.get(currentUser.id) || [];
        res.json({ success: true, history });
    }

    // 🔔 Notifications
    getNotifications(req, res) {
        const currentUser = req.user;
        const { page = 1, limit = 20 } = req.query;

        const userNotifications = currentUser.notifications
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedNotifications = userNotifications.slice(startIndex, endIndex);

        res.json({
            success: true,
            notifications: paginatedNotifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: userNotifications.length,
                hasMore: endIndex < userNotifications.length
            }
        });
    }

    markNotificationRead(req, res) {
        const { id } = req.params;
        const currentUser = req.user;

        const notification = currentUser.notifications.find(n => n.id === id);
        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        notification.read = true;
        notification.readAt = new Date();

        res.json({ success: true, message: 'Notification marked as read' });
    }

    deleteNotification(req, res) {
        const { id } = req.params;
        const currentUser = req.user;

        const notificationIndex = currentUser.notifications.findIndex(n => n.id === id);
        if (notificationIndex === -1) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        currentUser.notifications.splice(notificationIndex, 1);
        res.json({ success: true, message: 'Notification deleted' });
    }

    // 👤 Profile Management
    async uploadProfilePicture(req, res) {
        try {
            this.upload.single('profilePicture')(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ error: err.message });
                }

                if (!req.file) {
                    return res.status(400).json({ error: 'Profile picture is required' });
                }

                const user = req.user;
                
                const processedImagePath = join(process.cwd(), 'uploads/profiles', `processed-${req.file.filename}`);
                await sharp(req.file.path)
                    .resize(300, 300, { fit: 'cover' })
                    .jpeg({ quality: 90 })
                    .toFile(processedImagePath);

                user.profilePicture = `/uploads/profiles/processed-${req.file.filename}`;

                res.json({
                    success: true,
                    profilePicture: user.profilePicture,
                    message: 'Profile picture updated successfully'
                });
            });
        } catch (error) {
            this.server.logError('Error uploading profile picture:', error);
            res.status(500).json({ error: 'Failed to upload profile picture' });
        }
    }

    getProfile(req, res) {
        const { userId } = req.params;
        const user = this.users.get(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const profile = {
            ...this.server.sanitizeUser(user),
            posts: user.posts.map(postId => this.posts.get(postId)).filter(Boolean)
        };

        res.json({ success: true, profile });
    }

    editProfile(req, res) {
        const { username, bio, interests, preferences } = req.body;
        const user = req.user;

        if (username && username !== user.username) {
            for (const existingUser of this.users.values()) {
                if (existingUser.username === username && existingUser.id !== user.id) {
                    return res.status(409).json({ error: 'Username already taken' });
                }
            }
            user.username = this.server.sanitize(username);
        }

        if (bio !== undefined) user.bio = this.server.sanitize(bio);
        if (interests !== undefined) user.interests = interests;
        if (preferences !== undefined) {
            user.preferences = { ...user.preferences, ...preferences };
        }

        res.json({
            success: true,
            user: this.server.sanitizeUser(user),
            message: 'Profile updated successfully'
        });
    }

    // 🏆 Badge System
    getUserBadges(req, res) {
        const { userId } = req.params;
        const user = this.users.get(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            badges: user.badges,
            randomMatchFollows: user.stats.randomMatchFollows
        });
    }

    checkAndAwardBadges(user) {
        const { randomMatchFollows } = user.stats;
        
        if (randomMatchFollows >= 100 && !user.badges.includes('gold_star')) {
            user.badges.push('gold_star');
            this.createNotification(user.id, 'badge_earned', {
                badge: 'gold_star',
                message: 'Congratulations! You earned the Gold Star badge for 100 random match follows!'
            });
        } else if (randomMatchFollows >= 50 && !user.badges.includes('silver_star')) {
            user.badges.push('silver_star');
            this.createNotification(user.id, 'badge_earned', {
                badge: 'silver_star',
                message: 'Congratulations! You earned the Silver Star badge for 50 random match follows!'
            });
        } else if (randomMatchFollows >= 25 && !user.badges.includes('bronze_star')) {
            user.badges.push('bronze_star');
            this.createNotification(user.id, 'badge_earned', {
                badge: 'bronze_star',
                message: 'Congratulations! You earned the Bronze Star badge for 25 random match follows!'
            });
        }
    }

    // Enhanced Random Matching with Gender Preference
    findRandomMatchEnhanced(req, res) {
        const currentUser = req.user;
        const { genderPreference = 'both', maxRetries = 10 } = req.body;

        // Add user to matching queue if not already there
        if (!this.randomMatchQueue.has(currentUser.id)) {
            this.randomMatchQueue.set(currentUser.id, {
                userId: currentUser.id,
                genderPreference,
                joinedAt: new Date(),
                retries: 0
            });
        }

        const userQueue = this.randomMatchQueue.get(currentUser.id);
        userQueue.retries++;

        const potentialMatches = Array.from(this.users.values()).filter(user => {
            if (user.id === currentUser.id) return false;
            if (!user.isOnline || !user.preferences.allowRandomMatch) return false;

            if (genderPreference !== 'both' && user.gender !== genderPreference) return false;
            if (currentUser.preferences.matchGender !== 'both' &&
                currentUser.gender === user.gender) return false;

            return true;
        });

        if (potentialMatches.length === 0) {
            if (userQueue.retries < maxRetries) {
                return res.json({ 
                    success: false, 
                    message: 'No matches available, trying again...', 
                    retries: userQueue.retries,
                    maxRetries 
                });
            } else {
                this.randomMatchQueue.delete(currentUser.id);
                return res.json({ 
                    success: false, 
                    message: 'No matches found after maximum retries' 
                });
            }
        }

        const match = potentialMatches[Math.floor(Math.random() * potentialMatches.length)];
        const roomId = uuidv4();

        this.server.chatRooms.set(roomId, {
            id: roomId,
            type: 'random',
            participants: [currentUser.id, match.id],
            messages: [],
            createdAt: new Date(),
            isActive: true
        });

        // Mark this as a random match follow opportunity
        const followId = uuidv4();
        const followRequest = {
            id: followId,
            followerId: currentUser.id,
            followingId: match.id,
            status: 'random_match_opportunity',
            fromRandomMatch: true,
            createdAt: new Date()
        };

        this.follows.set(followId, followRequest);
        this.randomMatchQueue.delete(currentUser.id);

        this.server.logSuccess(`🎲 Enhanced random match: ${currentUser.username} ↔ ${match.username}`, {
            roomId,
            user1: currentUser.id,
            user2: match.id,
            genderPreference,
            retries: userQueue.retries
        });

        res.json({
            success: true,
            match: this.server.sanitizeUser(match),
            roomId,
            followOpportunity: followId
        });
    }

    // 🔔 Notification Helper
    createNotification(userId, type, data) {
        const user = this.users.get(userId);
        if (!user) return;

        const notificationId = uuidv4();
        const notification = {
            id: notificationId,
            type,
            data,
            read: false,
            createdAt: new Date()
        };

        user.notifications.unshift(notification);
        
        if (user.notifications.length > 100) {
            user.notifications = user.notifications.slice(0, 100);
        }

        this.server.io.to(`user_${userId}`).emit('new_notification', notification);
    }
}
