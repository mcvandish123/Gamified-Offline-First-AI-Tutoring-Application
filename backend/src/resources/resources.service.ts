import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase.service';
import Groq from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class ResourcesService {
  private groq: Groq;
  private ai: GoogleGenAI;
  private bucket: string;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get('GROQ_API_KEY') });
    this.ai = new GoogleGenAI({ apiKey: this.config.get('GEMINI_API_KEY') });
    this.bucket = this.config.get('SUPABASE_STORAGE_BUCKET') ?? 'resources';
  }

  async getOne(userId: string, resourceId: string) {
    const client = this.supabase.getClient();

    const { data, error } = await client
      .from('resources')
      .select(
        'id, user_id, title, file_url, file_type, is_processed, created_at',
      )
      .eq('id', resourceId)
      .eq('user_id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    return { success: true, resource: data };
  }

  async uploadResource(
    userId: string,
    file: Buffer,
    fileName: string,
    mimeType: string,
  ) {
    const client = this.supabase.getClient();

    const isImage = mimeType.startsWith('image/');
    const fileType = isImage ? 'image' : 'pdf';

    // 1. Upload file to Supabase Storage
    const filePath = `${userId}/${Date.now()}-${fileName}`;
    const { error: uploadError } = await client.storage
      .from(this.bucket)
      .upload(filePath, file, { contentType: mimeType });

    if (uploadError) throw new BadRequestException(uploadError.message);

    const { data: urlData } = client.storage
      .from(this.bucket)
      .getPublicUrl(filePath);

    // 2. Extract content — text for PDFs, vision description for images
    let rawText = '';

    if (!this.config.get('GEMINI_API_KEY')) {
      throw new BadRequestException(
        'GEMINI_API_KEY is not configured in backend .env file. Please add your Gemini API Key to run PDF/image multimodal parsing.',
      );
    }

    if (isImage) {
      const base64Image = file.toString('base64');
      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            'You are helping a student study. Extract and transcribe all text visible in this image. If it contains diagrams, equations, charts, graphs, or drawings, describe them clearly and thoroughly so a student can understand and study from your description. Output only the extracted content with no preamble.',
          ],
        });
        rawText = response.text || '';
      } catch (err) {
        console.error('Gemini vision extraction failed:', err);
        rawText = `[Image: ${fileName} — text extraction failed. The image is still stored and accessible via its URL.]`;
      }
    } else {
      const base64Pdf = file.toString('base64');
      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              inlineData: {
                data: base64Pdf,
                mimeType: 'application/pdf',
              },
            },
            'Analyze this PDF document. Extract all of its text content verbatim. For any diagrams, charts, tables, mathematical equations, graphs, or drawings, write clear, thorough, and context-rich descriptions so a student can study and learn from them. Output only the extracted document markdown with no conversational preamble.',
          ],
        });
        rawText = response.text || '';
      } catch (err) {
        console.error('Gemini PDF content extraction failed:', err);
        throw new BadRequestException(
          'Failed to process PDF file with Gemini API: ' + err.message,
        );
      }
    }

    // 3. Create resource row
    const { data: resource, error: resourceError } = await client
      .from('resources')
      .insert({
        user_id: userId,
        title: fileName,
        file_url: urlData.publicUrl,
        file_type: fileType,
        raw_text: rawText,
        is_processed: false,
      })
      .select()
      .single();

    if (resourceError) throw new BadRequestException(resourceError.message);

    return { success: true, resource };
  }

  async generateModules(userId: string, resourceId: string) {
    const client = this.supabase.getClient();

    const { data: resource, error } = await client
      .from('resources')
      .select('*')
      .eq('id', resourceId)
      .eq('user_id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    // PLACEHOLDER: Groq call goes here once API key is set
    // const completion = await this.groq.chat.completions.create({
    //   model: 'llama-3.1-70b-versatile',
    //   messages: [{ role: 'user', content: `Generate learning modules from: ${resource.raw_text}` }],
    // })

    return {
      success: true,
      message: 'Groq integration pending API key setup',
    };
  }
}
