import type { Assignment, Grade, Submission } from '../core/types';

export interface ClassroomData {
  assignments: Assignment[];
  submissions: Submission[];
}

/** Джерело завдань і зданих робіт (Google Клас). */
export interface ClassroomProvider {
  fetch(): Promise<ClassroomData>;
}

/** Джерело оцінок (Єдина школа). */
export interface GradesProvider {
  listGrades(from: Date, to: Date): Promise<Grade[]>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}
