import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodBody } from '../common/zod-swagger';
import { PlayersService } from './players.service';
import { CreatePlayerSchema, PlayerListQuerySchema } from '@tt-rating/types';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private players: PlayersService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated leaderboard' })
  async findAll(@Query() query: unknown) {
    const parsed = PlayerListQuerySchema.parse(query);
    return this.players.findAll(parsed);
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
