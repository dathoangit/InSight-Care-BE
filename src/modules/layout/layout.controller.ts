import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../decorators';
import { type ILayoutFloorDto, LayoutService } from './layout.service';

@ApiTags('layout')
@Controller('layout')
export class LayoutController {
  constructor(private readonly layoutService: LayoutService) {}

  @Get()
  @Auth()
  @ApiOkResponse({ description: 'Hospital floor-room-bed layout' })
  getLayout(): Promise<ILayoutFloorDto[]> {
    return this.layoutService.getLayout();
  }
}
