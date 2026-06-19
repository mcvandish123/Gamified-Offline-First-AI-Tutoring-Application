import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class FlashcardsService {
  constructor(private supabase: SupabaseService) {}

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

    if (existing) {
      const { data, error } = await client
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
      return { success: true, progress: data };
    }

    const { data, error } = await client
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
    return { success: true, progress: data };
  }
}
