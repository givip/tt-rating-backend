import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodBody } from '../common/zod-swagger';
import { CasualMatchesService } from '../casual-matches/casual-matches.service';
import { PlayersService } from './players.service';
import { CreatePlayerSchema, PlayerListQuerySchema } from '@tt-rating/types';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(
    private players: PlayersService,
    private casuals: CasualMatchesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated leaderboard' })
  async findAll(@Query() query: unknown) {
    const parsed = PlayerListQuerySchema.parse(query);
    return this.players.findAll(parsed);
  }

  @Get(':id/tournaments')
  @ApiOperation({ summary: 'Paginated tournament history for a player' })
  async playerTournaments(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.players.playerTournaments(id, {
      page: Math.max(1, parseInt(page ?? '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20)),
    });
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Paginated match history for a player' })
  async playerMatches(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    return this.players.playerMatches(id, {
      page: Math.max(1, parseInt(page ?? '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit ?? '30', 10) || 30)),
      since,
    });
  }

  @Get(':id/casual-matches')
  @ApiOperation({ summary: 'Casual-match history for a player' })
  async casualMatches(@Param('id') id: string) {
    return this.casuals.historyForPlayer(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get player profile with rating history' })
  async findOne(@Param('id') id: string) {
    return this.players.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create player profile' })
  @ZodBody(CreatePlayerSchema)
  async create(@Body() body: unknown) {
    const dto = CreatePlayerSchema.parse(body);
    // TODO: extract userId from JWT guard — for now accept as header for testing
    return this.players.create('user-placeholder', dto);
  }
}
