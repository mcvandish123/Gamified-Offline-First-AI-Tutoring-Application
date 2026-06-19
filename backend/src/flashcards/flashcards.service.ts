import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { AchievementsService } from '../achievements/achievements.service';
import { XpLogService } from '../xp-log/xp-log.service';

@Injectable()
export class FlashcardsService {
  constructor(
    private supabase: SupabaseService,
    private achievements: AchievementsService,
    private xpLog: XpLogService, // new dependency for logging XP
  ) {}

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

    // Only award XP for correct answers — small, simple rule for now
    if (wasCorrect) {
      await this.xpLog.logXp(userId, 5, 'flashcard'); // 5 XP per correct flashcard
    }

    // Check if this update unlocked any achievements
    await this.achievements.checkAchievements(userId);

    return { success: true, progress: data };
  }
}
