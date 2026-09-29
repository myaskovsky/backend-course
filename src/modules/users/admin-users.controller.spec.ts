import { AdminUsersController } from './admin-users.controller';
import { UserSortField, SortOrder } from './dto/list-users-query.dto';
import { UsersService } from './users.service';

describe('AdminUsersController', () => {
  it('delegates list to the users service', async () => {
    const usersService = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    } as unknown as jest.Mocked<UsersService>;
    const controller = new AdminUsersController(usersService);

    const query = {
      limit: 20,
      sort: UserSortField.CREATED_AT,
      order: SortOrder.DESC,
    };
    const res = await controller.list(query, {
      userId: 'admin-1',
      email: 'admin@example.com',
      roles: ['admin'],
    });

    expect(usersService.list).toHaveBeenCalledWith(query, 'admin-1');
    expect(res).toEqual({ items: [], nextCursor: null });
  });
});
