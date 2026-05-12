const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const OAuth2Strategy = require('passport-oauth2');
const Groq = require('groq-sdk');
require('dotenv').config();

// Import database and auth
const { initDatabase, database } = require('./database');
const authRoutes = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Session middleware (must be before passport)
app.use(session({
    secret: process.env.SESSION_SECRET || 'resumecraft-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    try {
        const user = database.get('SELECT id, email, name FROM users WHERE id = ?', [id]);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails[0].value;
        const name = profile.displayName;

        // Check if user exists
        let user = database.get('SELECT * FROM users WHERE email = ?', [email]);

        if (user) {
            // Update last login
            database.run('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
            return done(null, user);
        }

        // Create new user (no password for OAuth users)
        database.run(
            'INSERT INTO users (email, password, name, created_at) VALUES (?, ?, ?, datetime("now"))',
            [email, 'GOOGLE_OAUTH', name]
        );

        user = database.get('SELECT * FROM users WHERE email = ?', [email]);
        console.log(`✅ New Google user registered: ${email}`);

        done(null, user);
    } catch (error) {
        console.error('Google OAuth error:', error);
        done(error, null);
    }
}));

// LinkedIn OAuth Strategy (using OAuth2 with OpenID Connect)
passport.use('linkedin', new OAuth2Strategy({
    authorizationURL: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenURL: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL || 'http://localhost:3000/auth/linkedin/callback',
    scope: ['openid', 'profile', 'email']
}, async (accessToken, refreshToken, params, profile, done) => {
    try {
        // Decode the ID token to get user info
        const idToken = params.id_token;
        if (!idToken) {
            return done(new Error('No ID token received from LinkedIn'), null);
        }

        // Decode JWT (simple base64 decode - no verification for localhost)
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        
        const email = payload.email;
        const name = payload.name || payload.given_name || 'LinkedIn User';

        if (!email) {
            return done(new Error('No email from LinkedIn'), null);
        }

        // Check if user exists
        let user = database.get('SELECT * FROM users WHERE email = ?', [email]);

        if (user) {
            // Update last login
            database.run('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
            return done(null, user);
        }

        // Create new user
        database.run(
            'INSERT INTO users (email, password, name, created_at) VALUES (?, ?, ?, datetime("now"))',
            [email, 'LINKEDIN_OAUTH', name]
        );

        user = database.get('SELECT * FROM users WHERE email = ?', [email]);
        console.log(`✅ New LinkedIn user registered: ${email}`);

        done(null, user);
    } catch (error) {
        console.error('LinkedIn OAuth error:', error);
        done(error, null);
    }
}));

app.use(express.static('public'));

// Initialize Groq
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// Initialize database
initDatabase().then(() => {
    console.log('✅ Database ready!');
}).catch(err => {
    console.error('❌ Database initialization failed:', err);
});

// Auth routes
app.use('/auth', authRoutes);

// Google OAuth routes
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/index.html' }),
    (req, res) => {
        // Successful authentication
        req.session.userId = req.user.id;
        req.session.userEmail = req.user.email;
        console.log(`✅ Google login successful: ${req.user.email}`);
        res.redirect('/app.html');
    }
);

// LinkedIn OAuth routes
app.get('/auth/linkedin',
    passport.authenticate('linkedin')
);

app.get('/auth/linkedin/callback',
    passport.authenticate('linkedin', { 
        failureRedirect: '/',
        failureMessage: true 
    }),
    (req, res) => {
        // Successful authentication
        req.session.userId = req.user.id;
        req.session.userEmail = req.user.email;
        console.log(`✅ LinkedIn login successful: ${req.user.email}`);
        res.redirect('/app.html');
    }
);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'ResumeCraft Server Running - Free for Everyone! 💚',
        timestamp: new Date().toISOString()
    });
});

// Optimize resume endpoint
app.post('/api/optimize-resume', async (req, res) => {
    try {
        const { resume, jobDescription, template, font, keepOriginal } = req.body;

        if (!resume || !jobDescription) {
            return res.status(400).json({ 
                error: 'Both resume and job description are required' 
            });
        }

        console.log(`🚀 Optimizing resume with template: ${template || 'bold'}, font: ${font || 'modern'}, keepOriginal: ${keepOriginal}`);

        let formatInstructions = '';
        
        if (keepOriginal) {
            formatInstructions = `
IMPORTANT: Keep the exact same formatting structure as the original resume. 
Only rewrite and optimize the content itself. Maintain:
- The same section order
- The same heading styles
- The same bullet point format
- The same general layout structure
`;
        } else {
            // Template-specific formatting instructions
            const templateStyles = {
                minimal: `
Format with MINIMAL style:
- Clean, simple sections with clear headings
- Use all caps for section headers (EXPERIENCE, EDUCATION, SKILLS)
- Simple bullet points (•)
- No decorative elements
- Traditional professional structure`,
                
                bold: `
Format with BOLD style:
- Strong, prominent section headers in all caps
- Use bold text for job titles and company names
- Clear visual hierarchy
- Emphasize key achievements
- Modern professional layout`,
                
                modern: `
Format with MODERN style:
- Contemporary two-column concept (simulate with spacing)
- Contact info and skills can be grouped
- Clean lines and good use of whitespace
- Professional but creative layout
- Balance between sections`,
                
                classic: `
Format with CLASSIC style:
- Traditional, conservative layout
- Centered name and contact information
- Underlined or capitalized section headers
- Formal, time-tested structure
- Perfect for traditional industries`
            };

            formatInstructions = templateStyles[template] || templateStyles['bold'];
        }

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are an expert ATS (Applicant Tracking System) resume optimizer. Your goal is to help job seekers create resumes that pass ATS screening and get them interviews."
                },
                {
                    role: "user",
                    content: `Analyze this resume and job description, then create an ATS-friendly, optimized version.

CURRENT RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}

${formatInstructions}

Create an optimized ATS-friendly resume that:
1. Uses standard section headings (PROFESSIONAL SUMMARY, EXPERIENCE, EDUCATION, SKILLS)
2. Incorporates relevant keywords from the job description naturally
3. Uses simple formatting (no tables, columns, or graphics)
4. Highlights achievements with quantifiable metrics
5. Tailors content to match job requirements
6. Maintains professional, clear structure
7. Uses bullet points effectively
8. Keeps truthful information but optimizes presentation

Structure:
- Name and contact info at top
- PROFESSIONAL SUMMARY (2-3 compelling sentences tailored to the role)
- EXPERIENCE (with bullet points showing achievements with metrics)
- EDUCATION
- SKILLS (categorized and matched to job requirements)

Return ONLY the formatted resume text. No preamble, no explanation, no markdown formatting.`
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 4096,
        });

        const optimizedResume = chatCompletion.choices[0]?.message?.content || '';

        console.log('✅ Resume optimization completed!');

        // Track usage if user is logged in
        if (req.session.userId) {
            try {
                database.run(
                    'INSERT INTO usage_history (user_id, action, timestamp) VALUES (?, ?, datetime("now"))',
                    [req.session.userId, 'resume_generated']
                );
            } catch (err) {
                console.error('Failed to track usage:', err);
            }
        }

        res.json({ 
            optimizedResume,
            template: template || 'bold',
            font: font || 'modern',
            timestamp: new Date().toISOString(),
            message: 'Created with 💚 to help job seekers succeed'
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        
        let errorMessage = 'Failed to optimize resume';
        
        if (error.message.includes('API key')) {
            errorMessage = 'Invalid API key. Please check your GROQ_API_KEY in .env file';
        } else if (error.message.includes('rate limit')) {
            errorMessage = 'Rate limit reached. Please try again in a moment.';
        }
        
        res.status(500).json({ 
            error: errorMessage,
            message: error.message 
        });
    }
});

// Cover Letter Generation Route
app.post('/api/generate-cover-letter', async (req, res) => {
    try {
        const { resume, jobDescription } = req.body;

        if (!resume || !jobDescription) {
            return res.status(400).json({ 
                error: 'Both resume and job description are required' 
            });
        }

        console.log('📝 Generating cover letter...');

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are an expert cover letter writer who creates compelling, personalized cover letters that help job seekers stand out."
                },
                {
                    role: "user",
                    content: `Based on this resume and job description, write a professional, engaging cover letter.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}

Write a cover letter that:
1. Opens with a strong, specific hook that shows genuine interest
2. Highlights 2-3 key achievements from the resume that match the job requirements
3. Demonstrates understanding of the company/role
4. Shows enthusiasm and cultural fit
5. Ends with a confident call to action
6. Uses a professional yet warm tone
7. Is concise (3-4 paragraphs, about 250-350 words)

Format:
[Your Name]
[Your Contact Info]

[Date]

[Hiring Manager/Company Name]

Dear Hiring Manager,

[Opening paragraph with hook]

[Body paragraph 1: Match skills/experience to role]

[Body paragraph 2: Show enthusiasm and fit]

[Closing paragraph with call to action]

Sincerely,
[Your Name]

Return ONLY the formatted cover letter. No preamble, no explanation.`
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.8,
            max_tokens: 2048,
        });

        const coverLetter = chatCompletion.choices[0]?.message?.content || '';

        console.log('✅ Cover letter generated!');

        // Track usage
        if (req.session.userId) {
            try {
                database.run(
                    'INSERT INTO usage_history (user_id, action, timestamp) VALUES (?, ?, datetime("now"))',
                    [req.session.userId, 'cover_letter_generated']
                );
            } catch (err) {
                console.error('Failed to track usage:', err);
            }
        }

        res.json({ 
            optimizedResume: coverLetter,
            timestamp: new Date().toISOString(),
            message: 'Cover letter created with 💚'
        });

    } catch (error) {
        console.error('❌ Cover letter error:', error.message);
        res.status(500).json({ 
            error: 'Failed to generate cover letter',
            message: error.message 
        });
    }
});

// Job Suggestions Route - Chaining JSearch + Active Jobs DB + Jobs API
app.post('/api/suggest-jobs', async (req, res) => {
    try {
        const { resume } = req.body;
        if (!resume) return res.status(400).json({ error: 'Resume is required' });

        console.log('🔍 Extracting skills from resume...');

        // Step 1: Extract role + skills via Groq
        const skillsCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Extract key skills from resume. Be concise." },
                { role: "user", content: `Extract the top job role and 5 key skills from this resume for job searching in India.
Return in this EXACT format only:
ROLE: Financial Analyst
SKILLS: Excel, Financial Modeling, Data Analysis, SQL, Communication

RESUME:
${resume.substring(0, 2000)}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.3,
            max_tokens: 150,
        });

        const aiResponse = skillsCompletion.choices[0]?.message?.content || '';
        const roleMatch = aiResponse.match(/ROLE:\s*(.+)/);
        const skillsMatch = aiResponse.match(/SKILLS:\s*(.+)/);
        const primaryRole = roleMatch ? roleMatch[1].trim() : 'Analyst';
        const skills = skillsMatch ? skillsMatch[1].split(',').map(s => s.trim()) : ['Communication', 'Excel', 'Analysis'];

        console.log('✅ Role:', primaryRole, '| Skills:', skills.join(', '));

        const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
        let jobs = [];

        if (RAPIDAPI_KEY) {

            // --- API 1: JSearch (Google for Jobs) ---
            try {
                console.log('📡 Trying JSearch API...');
                const r1 = await fetch(
                    `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(primaryRole + ' India')}&page=1&num_pages=1&country=in&date_posted=week`,
                    { headers: { 'x-rapidapi-host': 'jsearch.p.rapidapi.com', 'x-rapidapi-key': RAPIDAPI_KEY } }
                );
                const d1 = await r1.json();
                if (d1.data && d1.data.length > 0) {
                    jobs = d1.data.slice(0, 8).map(job => ({
                        title: job.job_title,
                        company: job.employer_name,
                        location: [job.job_city, job.job_state, 'India'].filter(Boolean).join(', '),
                        experience: job.job_required_experience?.required_experience_in_months
                            ? `${Math.round(job.job_required_experience.required_experience_in_months / 12)} years`
                            : '0-3 years',
                        salary: job.job_min_salary
                            ? `₹${Math.round(job.job_min_salary / 100000)}-${Math.round(job.job_max_salary / 100000)} LPA`
                            : 'Not disclosed',
                        description: (job.job_description || '').substring(0, 250) + '...',
                        skills: skills.slice(0, 5),
                        link: job.job_apply_link || job.job_google_link,
                        posted: job.job_posted_at_datetime_utc
                            ? new Date(job.job_posted_at_datetime_utc).toLocaleDateString('en-IN')
                            : 'Recent',
                        source: 'JSearch'
                    }));
                    console.log(`✅ JSearch: ${jobs.length} jobs found`);
                }
            } catch (e) { console.error('JSearch failed:', e.message); }

            // --- API 2: Active Jobs DB (if JSearch returned < 4) ---
            if (jobs.length < 4) {
                try {
                    console.log('📡 Trying Active Jobs DB...');
                    const r2 = await fetch(
                        `https://active-jobs-db.p.rapidapi.com/active-ats-7d?limit=8&offset=0&title_filter=${encodeURIComponent(primaryRole)}&location_filter=India&description_type=text`,
                        { headers: { 'x-rapidapi-host': 'active-jobs-db.p.rapidapi.com', 'x-rapidapi-key': RAPIDAPI_KEY } }
                    );
                    const d2 = await r2.json();
                    const results = Array.isArray(d2) ? d2 : (d2.jobs || d2.data || []);
                    if (results.length > 0) {
                        const mapped = results.slice(0, 8 - jobs.length).map(job => ({
                            title: job.title || job.job_title,
                            company: job.company || job.employer_name || 'Company',
                            location: job.location || job.job_location || 'India',
                            experience: '0-3 years',
                            salary: 'Not disclosed',
                            description: (job.description || job.job_description || '').substring(0, 250) + '...',
                            skills: skills.slice(0, 5),
                            link: job.url || job.job_apply_link || job.apply_url,
                            posted: 'Recent',
                            source: 'Active Jobs DB'
                        }));
                        jobs = [...jobs, ...mapped];
                        console.log(`✅ Active Jobs DB added ${mapped.length} jobs`);
                    }
                } catch (e) { console.error('Active Jobs DB failed:', e.message); }
            }

            // --- API 3: Jobs API by Patrick (if still < 4) ---
            if (jobs.length < 4) {
                try {
                    console.log('📡 Trying Jobs API (Patrick)...');
                    const r3 = await fetch(
                        `https://jobs-api14.p.rapidapi.com/v2/list?query=${encodeURIComponent(primaryRole)}&location=India&autoTranslateLocation=false&remoteOnly=false&employmentTypes=fulltime`,
                        { headers: { 'x-rapidapi-host': 'jobs-api14.p.rapidapi.com', 'x-rapidapi-key': RAPIDAPI_KEY } }
                    );
                    const d3 = await r3.json();
                    const results = d3.jobs || d3.data || [];
                    if (results.length > 0) {
                        const mapped = results.slice(0, 8 - jobs.length).map(job => ({
                            title: job.title,
                            company: job.company || 'Company',
                            location: job.location || 'India',
                            experience: '0-3 years',
                            salary: job.salaryRange || 'Not disclosed',
                            description: (job.description || '').substring(0, 250) + '...',
                            skills: skills.slice(0, 5),
                            link: job.jobProviders?.[0]?.url || job.url,
                            posted: 'Recent',
                            source: 'Jobs API'
                        }));
                        jobs = [...jobs, ...mapped];
                        console.log(`✅ Jobs API added ${mapped.length} jobs`);
                    }
                } catch (e) { console.error('Jobs API failed:', e.message); }
            }
        }

        // --- Fallback: Groq with real career page links ---
        if (jobs.length === 0) {
            console.log('⚠️ All APIs failed or no key - using Groq fallback');
            const jobsCompletion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Generate job listings with ONLY direct company career page URLs. Never use LinkedIn or Naukri." },
                    { role: "user", content: `Generate 6 job listings in India for: ${primaryRole}
Skills: ${skills.join(', ')}

Use ONLY these real career URLs:
- TCS: https://www.tcs.com/careers
- Infosys: https://www.infosys.com/careers/india-jobs.html
- Wipro: https://careers.wipro.com/careers-home/jobs
- Accenture: https://www.accenture.com/in-en/careers/jobsearch
- Deloitte: https://apply.deloitte.com/careers/SearchJobs
- KPMG: https://kpmg.com/in/en/home/careers.html
- EY: https://careers.ey.com/ey/search/?q=${encodeURIComponent(primaryRole)}&locationsearch=India
- PwC: https://www.pwc.in/careers/experienced-career/search-and-apply.html
- Capgemini: https://www.capgemini.com/in-en/careers/job-search/
- Cognizant: https://careers.cognizant.com/in/en/search-results?keywords=${encodeURIComponent(primaryRole)}
- HCL: https://www.hcltech.com/careers/job-openings
- Tech Mahindra: https://careers.techmahindra.com/search/

Return ONLY a JSON array, no markdown:
[{"title":"...","company":"...","location":"...","experience":"0-2 years","salary":"₹X-Y LPA","description":"...","skills":["..."],"link":"...","posted":"Recent"}]` }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.5,
                max_tokens: 2000,
            });
            let t = jobsCompletion.choices[0]?.message?.content || '[]';
            t = t.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            try { jobs = JSON.parse(t); } catch (e) { jobs = []; }
        }

        console.log(`✅ Total: ${jobs.length} jobs returned`);
        res.json({ skills, jobs, role: primaryRole });

    } catch (error) {
        console.error('❌ Job suggestions error:', error.message);
        res.status(500).json({ error: 'Failed to generate job suggestions', message: error.message });
    }
});
app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🎯 ResumeCraft - Free for Everyone  ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`\n📍 Server running at: http://localhost:${PORT}`);
    console.log('💚 Powered by Groq AI - 100% Free');
    console.log('🚀 Helping job seekers succeed!\n');
    console.log('🔐 Auth system enabled!');
    console.log('════════════════════════════════════════\n');
});
