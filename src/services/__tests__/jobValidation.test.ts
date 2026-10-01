import { describe, it, expect } from 'vitest'
import { jobValidation, assertJobFormDataValid } from '../jobValidation'
import type { ValidationFailure } from '../jobValidation'
import type { JobFormData } from '@/types'

describe('jobValidation', () => {
  describe('validateCompany', () => {
    it('rejects empty company', () => {
      const error = jobValidation.validateCompany('')
      expect(error).not.toBeNull()
      expect(error?.field).toBe('company')
    })

    it('rejects company longer than 255 chars', () => {
      const longName = 'a'.repeat(256)
      const error = jobValidation.validateCompany(longName)
      expect(error).not.toBeNull()
      expect(error?.field).toBe('company')
    })

    it('accepts valid company name', () => {
      const error = jobValidation.validateCompany('Google')
      expect(error).toBeNull()
    })
  })

  describe('validateRole', () => {
    it('rejects empty role', () => {
      const error = jobValidation.validateRole('')
      expect(error).not.toBeNull()
      expect(error?.field).toBe('role')
    })

    it('rejects role longer than 255 chars', () => {
      const longRole = 'a'.repeat(256)
      const error = jobValidation.validateRole(longRole)
      expect(error).not.toBeNull()
    })

    it('accepts valid role', () => {
      const error = jobValidation.validateRole('Software Engineer')
      expect(error).toBeNull()
    })
  })

  describe('validateSalaryMin', () => {
    it('accepts null salary', () => {
      expect(jobValidation.validateSalaryMin(null)).toBeNull()
      expect(jobValidation.validateSalaryMin(undefined)).toBeNull()
    })

    it('rejects negative salary', () => {
      const error = jobValidation.validateSalaryMin(-1)
      expect(error).not.toBeNull()
    })

    it('rejects non-integer salary', () => {
      const error = jobValidation.validateSalaryMin(100.5)
      expect(error).not.toBeNull()
    })

    it('rejects unreasonably high salary', () => {
      const error = jobValidation.validateSalaryMin(11_000_000)
      expect(error).not.toBeNull()
    })

    it('accepts valid salary', () => {
      expect(jobValidation.validateSalaryMin(100_000)).toBeNull()
    })
  })

  describe('validateSalaryRange', () => {
    it('accepts both null', () => {
      expect(jobValidation.validateSalaryRange(null, null)).toBeNull()
      expect(jobValidation.validateSalaryRange(undefined, undefined)).toBeNull()
    })

    it('rejects min without max', () => {
      const error = jobValidation.validateSalaryRange(100_000, null)
      expect(error).not.toBeNull()
    })

    it('rejects max without min', () => {
      const error = jobValidation.validateSalaryRange(null, 150_000)
      expect(error).not.toBeNull()
    })

    it('rejects min > max', () => {
      const error = jobValidation.validateSalaryRange(150_000, 100_000)
      expect(error).not.toBeNull()
    })

    it('accepts valid range', () => {
      expect(jobValidation.validateSalaryRange(100_000, 150_000)).toBeNull()
    })

    it('accepts same min and max', () => {
      expect(jobValidation.validateSalaryRange(100_000, 100_000)).toBeNull()
    })
  })

  describe('validateWorkMode', () => {
    it('accepts null work_mode', () => {
      expect(jobValidation.validateWorkMode(null)).toBeNull()
      expect(jobValidation.validateWorkMode(undefined)).toBeNull()
    })

    it('accepts valid work modes', () => {
      expect(jobValidation.validateWorkMode('remote')).toBeNull()
      expect(jobValidation.validateWorkMode('hybrid')).toBeNull()
      expect(jobValidation.validateWorkMode('onsite')).toBeNull()
    })

    it('rejects invalid work mode', () => {
      const error = jobValidation.validateWorkMode('flexible' as JobFormData['work_mode'])
      expect(error).not.toBeNull()
      expect(error?.field).toBe('work_mode')
    })
  })

  describe('validateUrl', () => {
    it('accepts null url', () => {
      expect(jobValidation.validateUrl(null)).toBeNull()
      expect(jobValidation.validateUrl('')).toBeNull()
    })

    it('accepts https urls', () => {
      expect(jobValidation.validateUrl('https://www.linkedin.com/jobs/view/123')).toBeNull()
    })

    it('accepts http urls', () => {
      expect(jobValidation.validateUrl('http://indeed.com/job/123')).toBeNull()
    })

    it('accepts protocol-relative urls', () => {
      expect(jobValidation.validateUrl('//www.linkedin.com/jobs/view/123')).toBeNull()
    })

    it('rejects invalid urls', () => {
      expect(jobValidation.validateUrl('not a url')).not.toBeNull()
    })

    it('rejects urls longer than 2048 chars', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2050)
      const error = jobValidation.validateUrl(longUrl)
      expect(error).not.toBeNull()
    })
  })

  describe('validateDateApplied', () => {
    it('accepts null date', () => {
      expect(jobValidation.validateDateApplied(null)).toBeNull()
      expect(jobValidation.validateDateApplied('')).toBeNull()
    })

    it('accepts valid date format', () => {
      expect(jobValidation.validateDateApplied('2026-05-06')).toBeNull()
    })

    it('rejects invalid date format', () => {
      expect(jobValidation.validateDateApplied('05-06-2026')).not.toBeNull()
      expect(jobValidation.validateDateApplied('May 6, 2026')).not.toBeNull()
    })

    it('rejects invalid dates', () => {
      const error = jobValidation.validateDateApplied('2026-13-01')
      expect(error).not.toBeNull()
    })

    it('rejects future dates', () => {
      // Create a future date
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const futureDate = tomorrow.toISOString().split('T')[0]
      
      const error = jobValidation.validateDateApplied(futureDate)
      expect(error).not.toBeNull()
    })

    it('accepts today date', () => {
      const today = new Date().toISOString().split('T')[0]
      expect(jobValidation.validateDateApplied(today)).toBeNull()
    })

    it('accepts past dates', () => {
      expect(jobValidation.validateDateApplied('2026-01-01')).toBeNull()
    })
  })

  describe('validateEmail', () => {
    it('accepts null email', () => {
      expect(jobValidation.validateEmail(null)).toBeNull()
      expect(jobValidation.validateEmail('')).toBeNull()
    })

    it('accepts valid emails', () => {
      expect(jobValidation.validateEmail('user@example.com')).toBeNull()
      expect(jobValidation.validateEmail('john.doe@company.co.uk')).toBeNull()
    })

    it('rejects invalid emails', () => {
      expect(jobValidation.validateEmail('notanemail')).not.toBeNull()
      expect(jobValidation.validateEmail('user@')).not.toBeNull()
      expect(jobValidation.validateEmail('@example.com')).not.toBeNull()
    })

    it('rejects emails longer than 254 chars', () => {
      const longEmail = 'a'.repeat(250) + '@a.co' // 250 + 5 = 255 chars (exceeds 254 limit)
      const error = jobValidation.validateEmail(longEmail)
      expect(error).not.toBeNull()
    })
  })

  describe('validateLinkedInUrl', () => {
    it('accepts null', () => {
      expect(jobValidation.validateLinkedInUrl(null)).toBeNull()
    })

    it('accepts linkedin.com urls', () => {
      expect(jobValidation.validateLinkedInUrl('https://linkedin.com/in/johndoe')).toBeNull()
      expect(jobValidation.validateLinkedInUrl('https://www.linkedin.com/company/google')).toBeNull()
    })

    it('rejects non-linkedin urls', () => {
      const error = jobValidation.validateLinkedInUrl('https://twitter.com/user')
      expect(error).not.toBeNull()
    })
  })

  describe('validateContactName', () => {
    it('accepts null', () => {
      expect(jobValidation.validateContactName(null)).toBeNull()
      expect(jobValidation.validateContactName('')).toBeNull()
    })

    it('accepts valid names', () => {
      expect(jobValidation.validateContactName('John Doe')).toBeNull()
    })

    it('rejects names longer than 255 chars', () => {
      const longName = 'a'.repeat(256)
      const error = jobValidation.validateContactName(longName)
      expect(error).not.toBeNull()
    })
  })

  describe('validateTags', () => {
    it('accepts null tags', () => {
      expect(jobValidation.validateTags(null)).toBeNull()
    })

    it('accepts valid tag arrays', () => {
      expect(jobValidation.validateTags(['python', 'react'])).toBeNull()
    })

    it('rejects more than 50 tags', () => {
      const manyTags = Array.from({ length: 51 }, (_, i) => `tag${i}`)
      const error = jobValidation.validateTags(manyTags)
      expect(error).not.toBeNull()
    })

    it('rejects empty tag strings', () => {
      const error = jobValidation.validateTags(['python', ''])
      expect(error).not.toBeNull()
    })

    it('rejects tags longer than 50 chars', () => {
      const error = jobValidation.validateTags(['python', 'a'.repeat(51)])
      expect(error).not.toBeNull()
    })
  })

  describe('validateJobFormData', () => {
    it('accepts valid complete form', () => {
      const data: JobFormData = {
        company: 'Google',
        role: 'Software Engineer',
        status: 'applied',
        salary_min: 100_000,
        salary_max: 150_000,
        work_mode: 'remote',
        date_applied: '2026-05-06',
        contact_email: 'hiring@google.com',
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors).toHaveLength(0)
    })

    it('returns multiple errors', () => {
      const data: JobFormData = {
        company: '',
        role: '',
        status: 'applied',
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.map((e) => e.field)).toContain('company')
      expect(errors.map((e) => e.field)).toContain('role')
    })

    it('detects salary range violations', () => {
      const data: JobFormData = {
        company: 'Google',
        role: 'Software Engineer',
        status: 'applied',
        salary_min: 150_000,
        salary_max: 100_000,
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.message.includes('minimum cannot exceed maximum'))).toBe(true)
    })

    it('detects work_mode violations', () => {
      const data: JobFormData = {
        company: 'Google',
        role: 'Software Engineer',
        status: 'applied',
        work_mode: 'flexible' as JobFormData['work_mode'],
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.some((e) => e.field === 'work_mode')).toBe(true)
    })
  })

  describe('assertJobFormDataValid', () => {
    it('throws error for invalid data', () => {
      const data: JobFormData = {
        company: '',
        role: 'Software Engineer',
        status: 'applied',
      }

      expect(() => assertJobFormDataValid(data)).toThrow()
    })

    it('throws error with validationErrors property', () => {
      const data: JobFormData = {
        company: '',
        role: '',
        status: 'applied',
      }

      try {
        assertJobFormDataValid(data)
        expect.fail('Should have thrown')
      } catch (err) {
        const failure = err as ValidationFailure
        expect(failure.validationErrors).toBeDefined()
        expect(Array.isArray(failure.validationErrors)).toBe(true)
      }
    })

    it('does not throw for valid data', () => {
      const data: JobFormData = {
        company: 'Google',
        role: 'Software Engineer',
        status: 'applied',
        date_applied: '2026-01-15',
      }

      expect(() => assertJobFormDataValid(data)).not.toThrow()
    })
  })

  describe('an applied application has a date applied', () => {
    // The same rule the CHECK constraint `jobs_applied_requires_date` holds.
    it('refuses applied with no date, in words a person can act on', () => {
      const errors = jobValidation.validateJobFormData({ company: 'A', role: 'B', status: 'applied' })
      expect(errors).toContainEqual({ field: 'date_applied', message: 'Add the date you applied' })
    })

    it('accepts applied with a date, and any other status without one', () => {
      expect(
        jobValidation.validateJobFormData({ company: 'A', role: 'B', status: 'applied', date_applied: '2026-01-15' })
      ).toEqual([])
      for (const status of ['wishlist', 'interviewing', 'offer', 'rejected'] as const) {
        expect(jobValidation.validateJobFormData({ company: 'A', role: 'B', status })).toEqual([])
      }
    })
  })

  describe('Security: Prevent injection attacks', () => {
    it('accepts fields with special characters (sanitized by DB)', () => {
      const data: JobFormData = {
        company: "Google'; DROP TABLE jobs; --",
        role: 'Software Engineer',
        status: 'applied',
      }

      // Validation passes - DB & RLS should handle the rest
      const errors = jobValidation.validateJobFormData(data)
      const companyErrors = errors.filter((e) => e.field === 'company')
      expect(companyErrors).toHaveLength(0)
    })

    it('sanitizes URL inputs', () => {
      const maliciousUrl = 'javascript:alert("xss")'
      const error = jobValidation.validateUrl(maliciousUrl)
      expect(error).not.toBeNull()
    })
  })

  describe('Data Integrity: Salary boundaries', () => {
    it('accepts reasonable salary ranges', () => {
      const data: JobFormData = {
        company: 'Google',
        role: 'Software Engineer',
        status: 'applied',
        salary_min: 50_000,
        salary_max: 500_000,
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.filter((e) => e.field.includes('salary'))).toHaveLength(0)
    })

    it('rejects unreasonable salary ranges', () => {
      const data: JobFormData = {
        company: 'Google',
        role: 'Software Engineer',
        status: 'applied',
        salary_min: 1_000_000_000,
        salary_max: 2_000_000_000,
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.filter((e) => e.field.includes('salary')).length).toBeGreaterThan(0)
    })
  })
  describe('validateSalaryCurrency', () => {
    it('accepts every code the database CHECK allows', () => {
      for (const code of ['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'AUD']) {
        expect(jobValidation.validateSalaryCurrency(code)).toBeNull()
      }
    })

    it('rejects a code the database would refuse', () => {
      const err = jobValidation.validateSalaryCurrency('XYZ')
      expect(err).not.toBeNull()
      expect(err?.field).toBe('salary_currency')
    })

    it('treats an absent currency as valid, since the column defaults', () => {
      expect(jobValidation.validateSalaryCurrency(undefined)).toBeNull()
      expect(jobValidation.validateSalaryCurrency(null)).toBeNull()
    })
  })

  describe('M1 columns on JobFormData', () => {
    it('surfaces an unsupported currency through validateJobFormData', () => {
      const data = {
        company: 'Stripe',
        role: 'Software Engineer',
        status: 'applied',
        salary_currency: 'XYZ',
      } as unknown as JobFormData

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.some((e) => e.field === 'salary_currency')).toBe(true)
    })

    it('accepts a full-length job posting as the description', () => {
      const data: JobFormData = {
        company: 'Stripe',
        role: 'Software Engineer',
        status: 'applied',
        description: 'x'.repeat(8000),
      }

      const errors = jobValidation.validateJobFormData(data)
      expect(errors.filter((e) => e.field === 'description')).toHaveLength(0)
    })
  })
})
