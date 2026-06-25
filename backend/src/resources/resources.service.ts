import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase.service';
import Groq from 'groq-sdk';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class ResourcesService {
  private groq: Groq;
  private bucket: string;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get('GROQ_API_KEY') });
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

    if (isImage) {
      // Send the image to Groq's vision model to extract a study-relevant
      // text description, so it can be injected into the AI system prompt
      // exactly like a PDF's raw_text would be.
      const base64Image = file.toString('base64');
      try {
        const vision = await this.groq.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${base64Image}` },
                },
                {
                  type: 'text',
                  text: 'You are helping a student study. Extract and transcribe all text visible in this image. If it contains diagrams, equations, or charts, describe them clearly and thoroughly so a student can understand and study from your description. Output only the extracted content with no preamble.',
                },
              ],
            },
          ],
          max_tokens: 2048,
        });
        rawText = vision.choices[0]?.message?.content ?? '';
      } catch (err) {
        console.error('Groq vision extraction failed:', err);
        // Store a fallback so the resource row is still created — the
        // user can re-upload if the description is empty.
        rawText = `[Image: ${fileName} — text extraction failed. The image is still stored and accessible via its URL.]`;
      }
    } else {
      // PDF — extract text directly from the buffer
      const parser = new PDFParse({ data: file });
      const result = await parser.getText();
      rawText = result.text;
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
