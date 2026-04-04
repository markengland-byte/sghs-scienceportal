/* ================================================================
   Vercel Serverless Function: Generate DSM Questions via Gemini
   POST /api/generate-dsm
   Body: { standard: "BIO.3", questionCount: 25 }
   Headers: Authorization: Bearer <supabase-access-token>
   ================================================================ */

const SUPABASE_URL = 'https://cogpsieldrgeqlemhosy.supabase.co';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// SOL standard descriptions for Gemini context
const SOL_STANDARDS = {
  'BIO.1': {
    name: 'Scientific Investigation',
    topics: 'Scientific method, hypotheses, independent/dependent/controlled variables, experimental design, data collection, data analysis, graphs and tables, conclusions, accuracy vs precision, qualitative vs quantitative data, correlation vs causation, peer review, scientific models, scientific theories vs laws'
  },
  'BIO.2': {
    name: 'Biochemistry & Energy',
    topics: 'Properties of water, pH scale, acids and bases, organic molecules (carbohydrates, lipids, proteins, nucleic acids), monomers and polymers, enzymes, activation energy, enzyme-substrate complex, factors affecting enzyme activity (temperature, pH, concentration), ATP, photosynthesis overview, cellular respiration overview, comparing photosynthesis and cellular respiration'
  },
  'BIO.3': {
    name: 'Cell Structure & Function',
    topics: 'Cell theory, prokaryotic vs eukaryotic cells, plant vs animal cells, cell organelles and their functions (nucleus, ribosomes, mitochondria, chloroplasts, cell membrane, cell wall, ER, Golgi, vacuoles, lysosomes), cell membrane structure (phospholipid bilayer), passive transport (diffusion, osmosis, facilitated diffusion), active transport, hypertonic/hypotonic/isotonic solutions, cell cycle, mitosis phases and significance, meiosis phases and significance, comparing mitosis and meiosis, cell specialization and differentiation'
  },
  'BIO.4': {
    name: 'Bacteria & Viruses',
    topics: 'Characteristics of bacteria, bacterial cell structure, binary fission, beneficial vs harmful bacteria, antibiotics, characteristics of viruses, viral structure, lytic vs lysogenic cycle, how viruses reproduce, are viruses alive debate, viral diseases, bacterial diseases, prevention and treatment, immune system basics, vaccines'
  },
  'BIO.5': {
    name: 'Genetics & Inheritance',
    topics: 'DNA structure (nucleotides, base pairing, double helix), DNA replication, RNA types and structure, transcription, translation, codons and amino acids, gene expression, mutations (point, frameshift, chromosomal), genetic code, Mendel\'s laws (dominance, segregation, independent assortment), Punnett squares (monohybrid, dihybrid), genotype vs phenotype, homozygous vs heterozygous, incomplete dominance, codominance, multiple alleles, sex-linked traits, pedigree analysis, genetic disorders'
  },
  'BIO.6': {
    name: 'Classification & Diversity',
    topics: 'Linnaean taxonomy (domain, kingdom, phylum, class, order, family, genus, species), binomial nomenclature, dichotomous keys, cladograms, phylogenetic trees, three domains (Bacteria, Archaea, Eukarya), six kingdoms, characteristics used for classification, evolutionary relationships, homologous vs analogous structures, biodiversity, importance of classification'
  },
  'BIO.7': {
    name: 'Evolution',
    topics: 'Darwin\'s theory of natural selection, evidence for evolution (fossil record, comparative anatomy, embryology, molecular biology, biogeography), homologous structures, vestigial structures, analogous structures, adaptation, speciation, geographic isolation, reproductive isolation, genetic drift, gene flow, Hardy-Weinberg equilibrium concept, artificial selection, coevolution, convergent vs divergent evolution, punctuated equilibrium vs gradualism'
  },
  'BIO.8': {
    name: 'Ecology & Ecosystems',
    topics: 'Levels of ecological organization (organism, population, community, ecosystem, biome, biosphere), abiotic vs biotic factors, food chains and food webs, trophic levels, energy pyramids, producers/consumers/decomposers, biogeochemical cycles (carbon, nitrogen, water, phosphorus), photosynthesis and carbon cycle, population growth (exponential vs logistic), carrying capacity, limiting factors, predator-prey relationships, symbiosis (mutualism, commensalism, parasitism), competition, ecological succession (primary and secondary), Virginia ecosystems and watersheds, human impact on ecosystems'
  }
};

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify teacher auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify token by querying teachers table with it
    const teacherRes = await fetch(`${SUPABASE_URL}/rest/v1/teachers?select=id,is_admin`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const teachers = await teacherRes.json();
    if (!teachers || teachers.length === 0) {
      return res.status(403).json({ error: 'Not a teacher' });
    }
  } catch (e) {
    return res.status(403).json({ error: 'Auth verification failed' });
  }

  // Parse request
  const { standard, questionCount = 25 } = req.body || {};

  if (!standard || !SOL_STANDARDS[standard]) {
    return res.status(400).json({ error: 'Invalid standard. Use BIO.1 through BIO.8' });
  }

  const count = Math.min(Math.max(parseInt(questionCount) || 25, 5), 50);
  const solInfo = SOL_STANDARDS[standard];

  // Build Gemini prompt
  const prompt = `Generate exactly ${count} multiple-choice questions for Virginia Biology SOL standard ${standard}: ${solInfo.name}.

Topics to cover: ${solInfo.topics}

Requirements:
- Each question must test understanding of a specific concept, not just recall
- Mix difficulty levels: approximately 30% easy, 50% medium, 20% hard
- Each question has exactly 4 answer options (A, B, C, D)
- Exactly one correct answer per question
- Include a brief explanation (1-2 sentences) for why the correct answer is right
- Questions should be appropriate for high school biology students
- Do NOT reuse released Virginia SOL exam questions — create original questions
- Vary question formats: some definitional, some application, some scenario-based, some diagram interpretation (describe the diagram in text)

Return a JSON array of ${count} objects with these exact keys:
- questionText (string): the question stem
- optionA (string): answer choice A
- optionB (string): answer choice B
- optionC (string): answer choice C
- optionD (string): answer choice D
- correctAnswer (string): lowercase letter "a", "b", "c", or "d"
- explanation (string): brief explanation of the correct answer
- difficulty (string): "easy", "medium", or "hard"`;

  // Call Gemini API
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.8,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'Gemini API error', status: geminiRes.status });
    }

    const geminiData = await geminiRes.json();

    // Extract the generated text
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(502).json({ error: 'No content returned from Gemini' });
    }

    // Parse JSON from response
    let questions;
    try {
      questions = JSON.parse(text);
    } catch (parseErr) {
      // Try to extract JSON from markdown code block
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        questions = JSON.parse(match[1]);
      } else {
        console.error('Failed to parse Gemini response:', text.substring(0, 500));
        return res.status(502).json({ error: 'Failed to parse Gemini response' });
      }
    }

    // Validate shape
    if (!Array.isArray(questions)) {
      return res.status(502).json({ error: 'Gemini did not return an array' });
    }

    // Normalize and validate each question
    const validated = questions.map((q, i) => ({
      questionText: String(q.questionText || q.question_text || ''),
      optionA: String(q.optionA || q.option_a || q.options?.a || ''),
      optionB: String(q.optionB || q.option_b || q.options?.b || ''),
      optionC: String(q.optionC || q.option_c || q.options?.c || ''),
      optionD: String(q.optionD || q.option_d || q.options?.d || ''),
      correctAnswer: String(q.correctAnswer || q.correct_answer || q.correct || 'a').toLowerCase().charAt(0),
      explanation: String(q.explanation || ''),
      difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
      sortOrder: i
    })).filter(q => q.questionText && q.optionA && q.optionB && q.optionC && q.optionD);

    return res.status(200).json({
      success: true,
      standard: standard,
      standardName: solInfo.name,
      questionCount: validated.length,
      questions: validated
    });

  } catch (e) {
    console.error('Generate DSM error:', e);
    return res.status(500).json({ error: 'Internal server error: ' + e.message });
  }
};
