import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Permission } from './permission.entity';
import { Role } from './role.entity';

/**
 * Assignment "role -> permission -> actions".
 * If `actions` is null/empty, all actions of the permission are granted.
 */
@Entity({ name: 'grants' })
@Index('uq_grants_role_permission', ['roleId', 'permissionId'], {
  unique: true,
})
export class Grant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  roleId: string;

  @Column({ type: 'uuid' })
  permissionId: string;

  @Column({ type: 'text', array: true, nullable: true })
  actions: string[] | null;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role: Role;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permissionId' })
  permission: Permission;
}
