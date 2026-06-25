import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AchievementsService } from '../achievements/achievements.service';
import { XpLogService } from '../xp-log/xp-log.service';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { randomUUID } from 'crypto';

@Injectable()
export class FlashcardsService {
  private groq: Groq;

  constructor(
    private supabase: SupabaseService,
    private achievements: AchievementsService,
    private xpLog: XpLogService, // new dependency for logging XP
    private config: ConfigService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get('GROQ_API_KEY') });
  }

  async getForModule(userId: string, moduleId: string) {
    const client = this.supabase.getClient();

    // Verify the module belongs to this user before returning flashcards
    const { data: module, error: moduleError } = await client
      .from('modules')
      .select('id')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (moduleError) throw new BadRequestException('Module not found');

    const { data, error } = await client
      .from('flashcards')
      .select('*')
      .eq('module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return { success: true, flashcards: data };
  }

  async recordProgress(
    userId: string,
    flashcardId: string,
    wasCorrect: boolean,
  ) {
    const client = this.supabase.getClient();

    // Check if a progress row already exists for this user + flashcard
    const { data: existing } = await client
      .from('flashcard_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('flashcard_id', flashcardId)
      .maybeSingle();

    let data;

    if (existing) {
      // Card seen before — update the existing row
      const { data: updated, error } = await client
        .from('flashcard_progress')
        .update({
          was_correct: wasCorrect,
          times_seen: existing.times_seen + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new BadRequestException(error.message);
      data = updated;
    } else {
      // First time seeing this card — create a new row
      const { data: created, error } = await client
        .from('flashcard_progress')
        .insert({
          user_id: userId,
          flashcard_id: flashcardId,
          was_correct: wasCorrect,
          times_seen: 1,
          last_seen_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new BadRequestException(error.message);
      data = created;
    }

    // XP awards for flashcards have been disabled per user request
    let xpAwarded = false;

    // Check if this update unlocked any achievements (these can ALSO
    // add bonus XP on top of the flashcard XP above)
    const achievementResult = await this.achievements.checkAchievements(userId);

    // Only re-fetch user_progress if something could have actually
    // changed it (a correct answer, or an achievement's XP bonus) — on
    // a wrong answer with no unlock, skip the extra query entirely.
    // We re-fetch fresh here (rather than trusting logXp's own return
    // value) specifically because an achievement bonus, if any, is
    // applied AFTER logXp runs — so logXp's number could be stale by
    // that bonus amount.
    let userProgress = null;
    if (xpAwarded || achievementResult.newlyUnlocked.length > 0) {
      const { data: freshProgress } = await client
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .single();
      userProgress = freshProgress;
    }

    return {
      success: true,
      progress: data,
      userProgress, // fresh total_xp/streak, or null if nothing changed
      newlyUnlocked: achievementResult.newlyUnlocked, // [] if none
    };
  }

  async generateFlashcardsFromConversation(
    userId: string,
    moduleId: string,
    conversationId: string,
  ) {
    const client = this.supabase.getClient();

    // 1. Verify the module and conversation belong to this user
    const { data: module, error: moduleError } = await client
      .from('modules')
      .select('id')
      .eq('id', moduleId)
      .eq('user_id', userId)
      .single();

    if (moduleError || !module) throw new BadRequestException('Module not found or access denied');

    const { data: conversation, error: convError } = await client
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('module_id', moduleId)
      .eq('user_id', userId)
      .single();

    if (convError || !conversation) throw new BadRequestException('Conversation not found or access denied');

    // 2. Fetch all messages in this conversation
    const { data: messages, error: messagesError } = await client
      .from('module_chats')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (messagesError || !messages || messages.length === 0) {
      throw new BadRequestException('No messages found in this conversation');
    }

    // 3. Format the chat history for the prompt
    const chatHistory = messages
      .map((msg) => `${msg.role === 'user' ? 'Student' : 'Tutor'}: ${msg.content}`)
      .join('\n\n');

    // 4. Construct prompt for Groq
    const systemPrompt = `You are an educational assistant that compiles flashcards from a tutoring chat history.
Analyze the conversation below and identify the key educational concepts, definitions, equations, facts, or questions explained by the tutor.
Create a set of concise, high-quality flashcards to help the student review this material.

Format each flashcard as a JSON object with:
- "front": a short, clear question, prompt, or term (keep it brief and focused).
- "back": a concise, accurate answer, definition, or explanation.

Generate between 3 to 8 high-quality flashcards depending on the amount of content discussed.
Output ONLY a JSON array of objects. Do NOT include markdown code blocks, backticks, explanations, or any extra characters.
Example output format:
[
  {"front": "What is the key difference between SN1 and SN2 reactions?", "back": "SN1 is a two-step unimolecular reaction forming a carbocation intermediate, while SN2 is a one-step biomolecular reaction with simultaneous bond-breaking and bond-making."}
]`;

    let generatedJsonString = '[]';
    const modelToUse = 'llama-3.3-70b-versatile';
    const fallbackModel = 'llama-3.1-8b-instant';

    try {
      const completion = await this.groq.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here is the conversation:\n\n${chatHistory}` },
        ],
        temperature: 0.3,
      });
      generatedJsonString = completion.choices[0]?.message?.content || '[]';
    } catch (error) {
      console.warn(`Primary model failed for flashcard generation, trying fallback.`, error);
      try {
        const completion = await this.groq.chat.completions.create({
          model: fallbackModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here is the conversation:\n\n${chatHistory}` },
          ],
          temperature: 0.3,
        });
        generatedJsonString = completion.choices[0]?.message?.content || '[]';
      } catch (fallbackError) {
        console.error('Groq calls failed for flashcard generation.', fallbackError);
        throw new BadRequestException('Failed to generate flashcards from AI tutor.');
      }
    }

    // 5. Parse JSON response
    let rawCards: Array<{ front: string; back: string }> = [];
    try {
      let cleanedJson = generatedJsonString.trim();
      if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      rawCards = JSON.parse(cleanedJson);
      if (!Array.isArray(rawCards)) {
        throw new Error('Parsed result is not an array');
      }
    } catch (parseErr) {
      console.error('Failed to parse generated flashcards JSON:', parseErr, '\nRaw output was:', generatedJsonString);
      throw new BadRequestException('AI generated flashcards in an invalid format. Please try again.');
    }

    if (rawCards.length === 0) {
      throw new BadRequestException('No key terms or concepts could be extracted from this conversation to form flashcards.');
    }

    // 6. Insert flashcards into Supabase
    const now = new Date().toISOString();
    const flashcardsToInsert = rawCards.map((card) => ({
      id: randomUUID(),
      module_id: moduleId,
      conversation_id: conversationId,
      front: card.front,
      back: card.back,
      created_at: now,
    }));

    let insertedCards: any[] = [];
    const { data, error: insertError } = await client
      .from('flashcards')
      .insert(flashcardsToInsert)
      .select();

    if (insertError) {
      // Fallback: If conversation_id doesn't exist yet on the remote database, retry without it
      if (insertError.message.includes('conversation_id') || insertError.code === '42703') {
        console.warn('Supabase flashcards table missing conversation_id column. Retrying insert without it.');
        const fallbackInsert = flashcardsToInsert.map(({ conversation_id, ...rest }) => rest);
        const { data: retryData, error: retryError } = await client
          .from('flashcards')
          .insert(fallbackInsert)
          .select();

        if (retryError) throw new BadRequestException(retryError.message);
        insertedCards = retryData ?? [];
      } else {
        throw new BadRequestException(insertError.message);
      }
    } else {
      insertedCards = data ?? [];
    }

    return {
      success: true,
      message: `Successfully generated ${insertedCards.length} flashcards.`,
      flashcards: insertedCards,
    };
  }
}
