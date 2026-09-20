import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'permissions' })
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** resource identifier, e.g. "users" */
  @Index('uq_permissions_name', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** allowed actions for this resource, e.g. ["create", "read", "update"] */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  actions: string[];
}
