import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { randomUUID } from 'crypto';

@Injectable()
export class QuestionsService {
  private groq: Groq;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get('GROQ_API_KEY') });
  }

  async getForModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    // Verify the module belongs to this user
    const { data: module, error: moduleError } = await client
      .from('modules')
      .select('id')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (moduleError) throw new BadRequestException('Module not found');

    const { data, error } = await client
      .from('questions')
      .select('*')
      .eq('module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, questions: data };
  }

  async getOne(userId: string, questionId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('questions')
      .select('*, modules!inner(user_id)')
      .eq('id', questionId)
      .eq('modules.user_id', userId)
      .single();

    if (error) throw new BadRequestException('Question not found');

    return { success: true, question: data };
  }

  async generateQuestionsForModule(
    userId: string,
    moduleId: string,
    difficulty: string,
  ) {
    const client = this.supabase.getClient();

    // 1. Verify module exists and belongs to this user
    const { data: moduleData, error: moduleError } = await client
      .from('modules')
      .select('id, title, summary, key_terms, resource_id')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (moduleError || !moduleData) {
      throw new BadRequestException('Module not found or access denied');
    }

    // 2. Fetch resource content or conversation history to extract knowledge
    let sourceMaterial = '';

    if (moduleData.resource_id) {
      const { data: resource, error: resError } = await client
        .from('resources')
        .select('title, raw_text')
        .eq('id', moduleData.resource_id)
        .single();
      if (!resError && resource) {
        sourceMaterial += `[Resource title: ${resource.title}]\n${resource.raw_text || ''}\n\n`;
      }
    }

    // Check module chat history if resource is not sufficient or empty
    if (!sourceMaterial.trim()) {
      const { data: chats } = await client
        .from('module_chats')
        .select('role, content')
        .eq('module_id', moduleId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(40);

      if (chats && chats.length > 0) {
        sourceMaterial += `[Chat history study guide]\n` + chats
          .map((c) => `${c.role === 'user' ? 'Student' : 'AI Tutor'}: ${c.content}`)
          .join('\n');
      }
    }

    // Fallback: title, summary, and key terms
    if (!sourceMaterial.trim()) {
      sourceMaterial += `Module Title: ${moduleData.title}\n`;
      if (moduleData.summary) {
        sourceMaterial += `Module Summary: ${moduleData.summary}\n`;
      }
      if (moduleData.key_terms) {
        sourceMaterial += `Key Terms: ${JSON.stringify(moduleData.key_terms)}\n`;
      }
    }

    const validDifficulty = ['easy', 'medium', 'hard'].includes(difficulty)
      ? difficulty
      : 'easy';

    // 3. Construct system prompt
    const systemPrompt = `You are an expert tutor designing multiple choice quiz questions.
Create exactly 5 high-quality multiple choice questions based on the study materials provided.

Difficulty constraints:
- "easy": Focus on direct recall, definitions, key terms, and simple factual checks from the study guide.
- "medium": Focus on conceptual understanding, logic, comparing concepts, or explaining relationships.
- "hard": Focus on analytical reasoning, problem solving, subtle details, or evaluating complex scenarios.

Rules:
1. Provide exactly 4 options in the "choices" array for each question.
2. The "correct_answer" MUST exactly match one of the strings inside the "choices" array.
3. Keep the questions clear and specific to the study material.
4. Output format MUST be a raw JSON array of objects. Do not include markdown code blocks, backticks, or any preamble.

Example output:
[
  {
    "question_text": "What does ATP stand for?",
    "correct_answer": "Adenosine triphosphate",
    "difficulty": "${validDifficulty}",
    "type": "multiple_choice",
    "choices": [
      "Adenosine triphosphate",
      "Adenosine diphosphate",
      "Alanine tri-phosphate",
      "Ammonium tri-phosphate"
    ]
  }
]`;

    let generatedJsonString = '[]';
    const modelToUse = 'llama-3.3-70b-versatile';
    const fallbackModel = 'llama-3.1-8b-instant';

    try {
      const completion = await this.groq.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here are the study materials:\n\n${sourceMaterial}` },
        ],
        temperature: 0.4,
      });
      generatedJsonString = completion.choices[0]?.message?.content || '[]';
    } catch (error) {
      console.warn(`Primary model failed for quiz generation, trying fallback.`, error);
      try {
        const completion = await this.groq.chat.completions.create({
          model: fallbackModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here are the study materials:\n\n${sourceMaterial}` },
          ],
          temperature: 0.4,
        });
        generatedJsonString = completion.choices[0]?.message?.content || '[]';
      } catch (fallbackError) {
        console.error('Groq calls failed for quiz generation.', fallbackError);
        throw new BadRequestException('Failed to generate quiz. AI tutoring engine is offline.');
      }
    }

    // 4. Parse generated JSON
    let rawQuestions: Array<{
      question_text: string;
      correct_answer: string;
      choices: string[];
    }> = [];

    try {
      let cleanedJson = generatedJsonString.trim();
      if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      rawQuestions = JSON.parse(cleanedJson);
      if (!Array.isArray(rawQuestions)) {
        throw new Error('Response is not an array');
      }
    } catch (parseErr) {
      console.error('Failed to parse generated questions JSON:', parseErr, '\nRaw output was:', generatedJsonString);
      throw new BadRequestException('AI generated quiz in an invalid format. Please try again.');
    }

    if (rawQuestions.length === 0) {
      throw new BadRequestException('No questions could be extracted from these study materials.');
    }

    // 5. Delete existing questions for this difficulty + module
    const { error: deleteError } = await client
      .from('questions')
      .delete()
      .eq('module_id', moduleId)
      .eq('difficulty', validDifficulty);

    if (deleteError) {
      console.warn('Failed to delete old questions, proceeding with insertion:', deleteError.message);
    }

    // 6. Map and insert new questions
    const now = new Date().toISOString();
    const questionsToInsert = rawQuestions.map((q) => ({
      id: randomUUID(),
      module_id: moduleId,
      question_text: q.question_text,
      correct_answer: q.correct_answer,
      difficulty: validDifficulty,
      type: 'multiple_choice',
      choices: q.choices,
      created_at: now,
    }));

    const { data: insertedQuestions, error: insertError } = await client
      .from('questions')
      .insert(questionsToInsert)
      .select();

    if (insertError) {
      throw new BadRequestException(`Failed to save generated quiz: ${insertError.message}`);
    }

    return {
      success: true,
      message: `Successfully generated ${insertedQuestions?.length || 0} questions for difficulty ${validDifficulty}.`,
      questions: insertedQuestions || [],
    };
  }
}

