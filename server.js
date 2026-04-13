const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'ResumeCraft Server Running - Free for Everyone! 💚',
        timestamp: new Date().toISOString()
    });
});

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

app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🎯 ResumeCraft - Free for Everyone  ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`\n📍 Server running at: http://localhost:${PORT}`);
    console.log('💚 Powered by Groq AI - 100% Free');
    console.log('🚀 Helping job seekers succeed!\n');
    console.log('════════════════════════════════════════\n');
});
