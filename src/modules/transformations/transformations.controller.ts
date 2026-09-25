import {
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { RequestUser } from '@/modules/auth/auth.constants';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';

import { PaginatedHistoryDto } from './dto/history-item.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { TransformationsService } from './transformations.service';

@ApiTags('transformations')
@ApiCookieAuth('access_token')
@Controller('api/transformations')
export class TransformationsController {
  private readonly logger = new Logger(TransformationsController.name);

  constructor(
    private readonly transformationsService: TransformationsService,
  ) {}

  @Get('history')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "List the current user's transformation history" })
  @ApiOkResponse({ type: PaginatedHistoryDto })
  async history(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListHistoryQueryDto,
  ): Promise<PaginatedHistoryDto> {
    const page = await this.transformationsService.listHistory(
      actor.userId,
      query,
    );
    this.logger.log(
      `history.list actor=${actor.userId} count=${page.items.length}`,
    );
    return page;
  }

  @Get('history/:id/download')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Download a saved result file from your history' })
  @ApiOkResponse({ description: 'The saved file streamed as an attachment.' })
  @ApiForbiddenResponse({ description: 'Item does not belong to you.' })
  @ApiNotFoundResponse({ description: 'Item or saved file not found.' })
  @ApiGoneResponse({ description: 'Saved file has expired.' })
  async download(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const result = await this.transformationsService.getOwnDownload(
      actor.userId,
      id,
    );
    this.logger.log(`history.download actor=${actor.userId} item=${id}`);
    return new StreamableFile(result.stream, {
      type: result.contentType,
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
}
