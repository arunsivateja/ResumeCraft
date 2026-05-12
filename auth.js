const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { database } = require('./database');

// Signup
router.post('/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Check if user exists
        const existingUser = database.get('SELECT * FROM users WHERE email = ?', [email]);
        
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        database.run(
            'INSERT INTO users (email, password, name, created_at) VALUES (?, ?, ?, datetime("now"))',
            [email, hashedPassword, name || '']
        );

        // Get the created user
        const newUser = database.get('SELECT id, email, name FROM users WHERE email = ?', [email]);

        // Set session
        req.session.userId = newUser.id;
        req.session.userEmail = newUser.email;

        console.log(`✅ New user registered: ${email}`);

        res.json({
            success: true,
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const user = database.get('SELECT * FROM users WHERE email = ?', [email]);

        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Update last login
        database.run(
            'UPDATE users SET last_login = datetime("now") WHERE id = ?',
            [user.id]
        );

        // Set session
        req.session.userId = user.id;
        req.session.userEmail = user.email;

        console.log(`✅ User logged in: ${email}`);

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Failed to login' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Check if logged in
router.get('/check', (req, res) => {
    if (req.session.userId) {
        const user = database.get(
            'SELECT id, email, name FROM users WHERE id = ?',
            [req.session.userId]
        );
        
        if (user) {
            return res.json({ loggedIn: true, user });
        }
    }
    
    res.json({ loggedIn: false });
});

// Get user's saved resumes
router.get('/resumes', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        const resumes = database.all(
            'SELECT id, title, template, font, created_at FROM resumes WHERE user_id = ? ORDER BY created_at DESC',
            [req.session.userId]
        );

        res.json({ resumes });
    } catch (error) {
        console.error('Error fetching resumes:', error);
        res.status(500).json({ error: 'Failed to fetch resumes' });
    }
});

// Get specific resume
router.get('/resumes/:id', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        const resume = database.get(
            'SELECT * FROM resumes WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]
        );

        if (!resume) {
            return res.status(404).json({ error: 'Resume not found' });
        }

        res.json({ resume });
    } catch (error) {
        console.error('Error fetching resume:', error);
        res.status(500).json({ error: 'Failed to fetch resume' });
    }
});

// Save resume
router.post('/resumes/save', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        const { title, content, template, font } = req.body;

        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content required' });
        }

        database.run(
            'INSERT INTO resumes (user_id, title, content, template, font, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
            [req.session.userId, title, content, template || 'bold', font || 'modern']
        );

        // Track usage
        database.run(
            'INSERT INTO usage_history (user_id, action, timestamp) VALUES (?, ?, datetime("now"))',
            [req.session.userId, 'resume_saved']
        );

        console.log(`✅ Resume saved for user ${req.session.userEmail}`);

        res.json({ success: true, message: 'Resume saved successfully' });
    } catch (error) {
        console.error('Error saving resume:', error);
        res.status(500).json({ error: 'Failed to save resume' });
    }
});

// Delete resume
router.delete('/resumes/:id', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        database.run(
            'DELETE FROM resumes WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]
        );

        console.log(`✅ Resume deleted for user ${req.session.userEmail}`);

        res.json({ success: true, message: 'Resume deleted successfully' });
    } catch (error) {
        console.error('Error deleting resume:', error);
        res.status(500).json({ error: 'Failed to delete resume' });
    }
});

module.exports = router;
