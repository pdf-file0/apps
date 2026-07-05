import type { z } from 'zod'
import type {
  AnswerBankEntrySchema,
  AnswerBankSchema,
  CandidateIdentitySchema,
  CandidateProfileFileSchema,
  DemographicEntrySchema,
  EducationEntrySchema,
  ExperienceSchema,
  ProfileSubmissionPolicySchema,
  UnresolvedItemSchema,
} from './schemas'

export type CandidateIdentity = z.infer<typeof CandidateIdentitySchema>
export type EducationEntry = z.infer<typeof EducationEntrySchema>
export type DemographicEntry = z.infer<typeof DemographicEntrySchema>
export type ProfileSubmissionPolicy = z.infer<typeof ProfileSubmissionPolicySchema>
export type UnresolvedItem = z.infer<typeof UnresolvedItemSchema>
export type Experience = z.infer<typeof ExperienceSchema>
export type CandidateProfile = z.infer<typeof CandidateProfileFileSchema>
export type AnswerBankEntry = z.infer<typeof AnswerBankEntrySchema>
export type AnswerBank = z.infer<typeof AnswerBankSchema>
