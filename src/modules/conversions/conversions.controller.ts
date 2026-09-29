import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '@/modules/auth/auth.constants';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';

import { ConversionsService, StagedUpload } from './conversions.service';
import { ConvertDto } from './dto/convert.dto';
import { FormatPairDto } from './dto/formats-response.dto';

// @fastify/multipart augments FastifyRequest with isMultipart()/parts().
const FILE_TOO_LARGE_CODE = 'FST_REQ_FILE_TOO_LARGE';

@ApiTags('conversions')
@ApiCookieAuth('access_token')
@Controller('api/convert')
export class ConversionsController {
  constructor(private readonly conversionsService: ConversionsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Convert a text file between CSV, JSON, XML, and YAML',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ConvertDto })
  @ApiOkResponse({ description: 'Converted file streamed as an attachment.' })
  @ApiBadRequestResponse({ description: 'Invalid file, params, or syntax.' })
  @ApiPayloadTooLargeResponse({ description: 'File exceeds the size limit.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'Not multipart, or unsupported source format.',
  })
  async convert(
    @Req() rawReq: FastifyRequest,
    @CurrentUser() actor: RequestUser,
  ): Promise<StreamableFile> {
    if (!rawReq.isMultipart()) {
      throw new UnsupportedMediaTypeException(
        'Request must be multipart/form-data',
      );
    }

    let upload: StagedUpload | undefined;
    let targetFormatRaw: string | undefined;
    let saveRaw: string | undefined;

    try {
      for await (const part of rawReq.parts()) {
        if (part.type === 'file') {
          // Streamed straight to a temp file — never buffered in memory.
          upload = await this.conversionsService.stageUpload(
            part.filename,
            part.file,
          );
        } else if (part.type === 'field' && typeof part.value === 'string') {
          if (part.fieldname === 'targetFormat') {
            targetFormatRaw = part.value;
          } else if (part.fieldname === 'save') {
            saveRaw = part.value;
          }
        }
      }
    } catch (err) {
      await this.conversionsService.discard(upload);
      if ((err as { code?: string }).code === FILE_TOO_LARGE_CODE) {
        throw new PayloadTooLargeException('File exceeds the size limit');
      }
      throw err;
    }

    const result = await this.conversionsService.convert({
      userId: actor.userId,
      targetFormatRaw,
      upload,
      save: saveRaw === 'true',
    });

    return new StreamableFile(result.stream, {
      type: result.contentType,
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('formats')
  @ApiOperation({ summary: 'List all supported conversion directions' })
  @ApiOkResponse({ type: FormatPairDto, isArray: true })
  listFormats(): FormatPairDto[] {
    return this.conversionsService.listFormats();
  }
}
