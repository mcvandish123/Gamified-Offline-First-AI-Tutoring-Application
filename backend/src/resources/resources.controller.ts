import {
  Controller,
  Get,
  Post,
  Param,
  Headers,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResourcesService } from './resources.service';
import { SupabaseService } from '../supabase.service';
import { extractUserId } from '../extract-user-id';

@Controller('resources')
export class ResourcesController {
  constructor(
    private resourcesService: ResourcesService,
    private supabase: SupabaseService,
  ) {}

  private getUserId(authorization: string): string {
    return extractUserId(authorization);
  }

  @Get(':id')
  async getOne(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(authorization);
    return this.resourcesService.getOne(userId, id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Headers('authorization') authorization: string,
    @UploadedFile() file: any,
    @Body('mimeType') mimeType: string,
  ) {
    const userId = this.getUserId(authorization);
    return this.resourcesService.uploadResource(
      userId,
      file.buffer,
      file.originalname,
      mimeType || file.mimetype,
    );
  }

  @Post(':id/generate')
  async generate(
    @Headers('authorization') authorization: string,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(authorization);
    return this.resourcesService.generateModules(userId, id);
  }
}
