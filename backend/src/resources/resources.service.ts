import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase.service';
import Groq from 'groq-sdk';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class ResourcesService {
  private groq: Groq;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get('GROQ_API_KEY') });
  }

  async uploadResource(userId: string, file: Buffer, fileName: string) {
    const client = this.supabase.getClient();

    // 1. Upload file to Supabase Storage
    const filePath = `${userId}/${Date.now()}-${fileName}`;
    const { error: uploadError } = await client.storage
      .from('resources')
      .upload(filePath, file, { contentType: 'application/pdf' });

    if (uploadError) throw new BadRequestException(uploadError.message);

    const { data: urlData } = client.storage
      .from('resources')
      .getPublicUrl(filePath);

    // 2. Extract text from PDF
    const parser = new PDFParse({ data: file }); // 'data' takes a Buffer directly
    const result = await parser.getText();
    const rawText = result.text;

    // 3. Create resource row
    const { data: resource, error: resourceError } = await client
      .from('resources')
      .insert({
        user_id: userId,
        title: fileName,
        file_url: urlData.publicUrl,
        file_type: 'pdf',
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
