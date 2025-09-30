// Posts Component - Enhanced Social Media Features
class PostsManager {
    constructor() {
        this.posts = [];
        this.currentPage = 1;
        this.postsPerPage = 10;
        this.initializePostsUI();
    }

    initializePostsUI() {
        // Create posts section in the main container
        const postsHTML = `
            <div class="card" style="margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3><i class="fas fa-images"></i> Create Post</h3>
                    <button id="create-post-btn" class="btn btn-primary">
                        <i class="fas fa-plus"></i> New Post
                    </button>
                </div>
            </div>
            
            <div id="create-post-modal" class="modal">
                <div class="modal-content">
                    <h3>Create New Post</h3>
                    <form id="create-post-form" enctype="multipart/form-data">
                        <div class="form-group">
                            <label>Content</label>
                            <textarea id="post-content" class="form-control" rows="4" placeholder="What's on your mind?"></textarea>
                        </div>
                        <div class="form-group">
                            <label>Image</label>
                            <input type="file" id="post-image" class="form-control" accept="image/*">
                            <div id="image-preview" class="image-preview" style="display:none; margin-top:0.5rem;"></div>
                        </div>
                        <div class="form-group">
                            <label>Caption</label>
                            <input type="text" id="post-caption" class="form-control" placeholder="Add a caption...">
                        </div>
                        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                            <button type="button" class="btn btn-ghost" id="cancel-post">Cancel</button>
                            <button type="submit" class="btn btn-primary">Share Post</button>
                        </div>
                    </form>
                </div>
            </div>

            <div id="posts-feed">
                <div id="posts-loading" style="display:none; text-align:center; padding:2rem;">
                    <i class="fas fa-spinner fa-spin"></i> Loading posts...
                </div>
                <div id="posts-container"></div>
                <button id="load-more-posts" class="btn btn-outline" style="width:100%; margin-top:1rem; display:none;">Load More</button>
            </div>
        `;

        const mount = document.getElementById('postsHost');
        if (mount) {
            mount.innerHTML = postsHTML;
            this.bindPostsEvents();
            // Auto-load feed when posts section is active
            setTimeout(() => this.loadFeed(1), 500);
        }
    }

    bindPostsEvents() {
        // Create post modal
        const createBtn = document.getElementById('create-post-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                document.getElementById('create-post-modal').classList.add('active');
            });
        }

        // Close modal
        const cancelBtn = document.getElementById('cancel-post');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.closeCreatePostModal();
            });
        }

        // Image preview
        document.getElementById('post-image').addEventListener('change', (e) => {
            this.previewImage(e.target.files[0]);
        });

        // Create post form
        document.getElementById('create-post-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createPost();
        });

        // Load more posts
        document.getElementById('load-more-posts').addEventListener('click', () => {
            this.loadMorePosts();
        });
    }

    previewImage(file) {
        const preview = document.getElementById('image-preview');
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
                preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        } else {
            preview.classList.add('hidden');
        }
    }

    async createPost() {
        const content = document.getElementById('post-content').value;
        const caption = document.getElementById('post-caption').value;
        const imageFile = document.getElementById('post-image').files[0];

        if (!content && !imageFile) {
            showNotification('Please add content or an image', 'error');
            return;
        }

        const formData = new FormData();
        if (content) formData.append('content', content);
        if (caption) formData.append('caption', caption);
        if (imageFile) formData.append('image', imageFile);

        try {
            const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
            const token = localStorage.getItem('authToken') || window.authToken;
            const response = await fetch(`${API_BASE}/posts/create`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            const result = await response.json();
            if (result.success) {
                showNotification('Post created successfully!', 'success');
                this.closeCreatePostModal();
                this.refreshFeed();
            } else {
                showNotification(result.error || 'Failed to create post', 'error');
            }
        } catch (error) {
            showNotification('Error creating post', 'error');
        }
    }

    closeCreatePostModal() {
        document.getElementById('create-post-modal').classList.remove('active');
        document.getElementById('create-post-form').reset();
        document.getElementById('image-preview').style.display = 'none';
    }

    async loadFeed(page = 1) {
        const loadingEl = document.getElementById('posts-loading');
        if (loadingEl) loadingEl.style.display = 'block';
        
        try {
            const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
            const token = localStorage.getItem('authToken') || window.authToken;
            const response = await fetch(`${API_BASE}/posts/feed?page=${page}&limit=${this.postsPerPage}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const result = await response.json();
            if (result.success) {
                if (page === 1) {
                    this.posts = result.posts;
                    this.renderPosts();
                } else {
                    this.posts = [...this.posts, ...result.posts];
                    this.renderNewPosts(result.posts);
                }

                // Show/hide load more button
                const loadMoreBtn = document.getElementById('load-more-posts');
                if (result.pagination.hasMore) {
                    loadMoreBtn.classList.remove('hidden');
                } else {
                    loadMoreBtn.classList.add('hidden');
                }
            }
        } catch (error) {
            showNotification('Error loading posts', 'error');
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
    }

    renderPosts() {
        const container = document.getElementById('posts-container');
        container.innerHTML = '';
        this.posts.forEach(post => {
            container.appendChild(this.createPostElement(post));
        });
    }

    renderNewPosts(newPosts) {
        const container = document.getElementById('posts-container');
        newPosts.forEach(post => {
            container.appendChild(this.createPostElement(post));
        });
    }

    createPostElement(post) {
        const postElement = document.createElement('div');
        postElement.className = 'post-card';
        postElement.innerHTML = `
            <div class="post-header">
                <div class="post-user">
                    <div class="user-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="user-info">
                        <h4>${post.username}</h4>
                        <span class="post-time">${this.formatTime(post.createdAt)}</span>
                    </div>
                </div>
                <div class="post-actions">
                    <button class="btn-icon" onclick="postsManager.showPostOptions('${post.id}')">
                        <i class="fas fa-ellipsis-h"></i>
                    </button>
                </div>
            </div>
            
            ${post.content ? `<div class="post-content">${post.content}</div>` : ''}
            
            ${post.imageUrl ? `
                <div class="post-image">
                    <img src="${post.imageUrl}" alt="Post image" onclick="postsManager.openImageModal('${post.imageUrl}')">
                </div>
            ` : ''}
            
            ${post.caption ? `<div class="post-caption">${post.caption}</div>` : ''}
            
            <div class="post-stats">
                <span class="likes-count">${post.likes.length} likes</span>
                <span class="comments-count">${post.comments.length} comments</span>
            </div>
            
            <div class="post-interactions">
                <button class="interaction-btn ${post.likes && window.currentUser && post.likes.includes(window.currentUser?.id) ? 'active' : ''}" 
                        onclick="postsManager.toggleLike('${post.id}')">
                    <i class="fas fa-heart"></i> Like
                </button>
                <button class="interaction-btn" onclick="postsManager.showComments('${post.id}')">
                    <i class="fas fa-comment"></i> Comment
                </button>
                <button class="interaction-btn" onclick="postsManager.sharePost('${post.id}')">
                    <i class="fas fa-share"></i> Share
                </button>
            </div>
            
            <div id="comments-${post.id}" class="comments-section hidden">
                <div class="add-comment">
                    <input type="text" placeholder="Write a comment..." id="comment-input-${post.id}">
                    <button onclick="postsManager.addComment('${post.id}')" class="btn btn-sm">Post</button>
                </div>
                <div class="comments-list" id="comments-list-${post.id}"></div>
            </div>
        `;
        return postElement;
    }

    async toggleLike(postId) {
        try {
            const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
            const token = localStorage.getItem('authToken') || window.authToken;
            const response = await fetch(`${API_BASE}/posts/${postId}/like`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const result = await response.json();
            if (result.success) {
                // Update UI
                const post = this.posts.find(p => p.id === postId);
                if (post && window.currentUser) {
                    if (result.liked) {
                        post.likes.push(window.currentUser.id);
                    } else {
                        post.likes = post.likes.filter(id => id !== window.currentUser.id);
                    }
                    this.updatePostStats(postId, post);
                }
            }
        } catch (error) {
            showNotification('Error updating like', 'error');
        }
    }

    async addComment(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        const content = input.value.trim();
        
        if (!content) return;

        try {
            const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
            const token = localStorage.getItem('authToken') || window.authToken;
            const response = await fetch(`${API_BASE}/posts/${postId}/comment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ content })
            });

            const result = await response.json();
            if (result.success) {
                input.value = '';
                this.addCommentToUI(postId, result.comment);
                
                // Update comments count
                const post = this.posts.find(p => p.id === postId);
                if (post) {
                    post.comments.push(result.comment.id);
                    this.updatePostStats(postId, post);
                }
            }
        } catch (error) {
            showNotification('Error adding comment', 'error');
        }
    }

    addCommentToUI(postId, comment) {
        const commentsList = document.getElementById(`comments-list-${postId}`);
        const commentElement = document.createElement('div');
        commentElement.className = 'comment';
        commentElement.innerHTML = `
            <div class="comment-user">${comment.username}</div>
            <div class="comment-content">${comment.content}</div>
            <div class="comment-time">${this.formatTime(comment.createdAt)}</div>
        `;
        commentsList.appendChild(commentElement);
    }

    showComments(postId) {
        const commentsSection = document.getElementById(`comments-${postId}`);
        commentsSection.classList.toggle('hidden');
    }

    updatePostStats(postId, post) {
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            const likesCount = postElement.querySelector('.likes-count');
            const commentsCount = postElement.querySelector('.comments-count');
            
            if (likesCount) likesCount.textContent = `${post.likes.length} likes`;
            if (commentsCount) commentsCount.textContent = `${post.comments.length} comments`;
        }
    }

    refreshFeed() {
        this.currentPage = 1;
        this.loadFeed(1);
    }

    loadMorePosts() {
        this.currentPage++;
        this.loadFeed(this.currentPage);
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    }

    openImageModal(imageUrl) {
        // Create and show image modal
        const modal = document.createElement('div');
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="image-modal-content">
                <span class="close">&times;</span>
                <img src="${imageUrl}" alt="Full size image">
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('.close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }
}

// Initialize posts manager
let postsManager;
document.addEventListener('DOMContentLoaded', () => {
    postsManager = new PostsManager();
    // Simple fallback notifier
    if (!window.showNotification) {
        window.showNotification = (msg, type='info') => {
            console.log(`[${type}]`, msg);
        }
    }
});
