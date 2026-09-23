import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Kind of transformation. `file` covers text-format conversions; `image` is
 * reserved so a future image pipeline shares this unified history store.
 */
export enum TransformationType {
  FILE = 'file',
  IMAGE = 'image',
}

export enum TransformationStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

/**
 * Audit record persisted for every transformation attempt (success or error).
 * File contents are never stored in the DB — only metadata. When the user asks
 * to save the result (`save=true`), the file is written to the storage backend
 * and `fileId` points at it; `expiresAt` bounds the lifetime of both the record
 * and any saved file (enforced by the background cleanup job).
 */
@Entity({ name: 'transformation_history' })
@Index('idx_transformation_history_user_created', ['userId', 'createdAt'])
@Index('idx_transformation_history_type', ['type'])
@Index('idx_transformation_history_status', ['status'])
@Index('idx_transformation_history_expires', ['expiresAt'])
export class TransformationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: TransformationType,
    default: TransformationType.FILE,
  })
  type: TransformationType;

  @Column({ type: 'varchar', length: 16 })
  sourceFormat: string;

  @Column({ type: 'varchar', length: 16 })
  targetFormat: string;

  @Column({ type: 'enum', enum: TransformationStatus })
  status: TransformationStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'int' })
  fileSize: number;

  @Column({ type: 'int' })
  durationMs: number;

  /**
   * Storage id of the saved result file, or null when the result was not saved.
   * Doubles as the on-disk filename in the local storage backend.
   */
  @Column({ type: 'uuid', nullable: true })
  fileId: string | null;

  /** Size in bytes of the saved result file (null when not saved). */
  @Column({ type: 'int', nullable: true })
  resultSize: number | null;

  /**
   * When this record (and its saved file, if any) expires and becomes eligible
   * for deletion by the cleanup job. Set for every record at insert time.
   */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
