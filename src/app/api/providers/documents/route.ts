import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-user'
import { checkRateLimitAsync } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import type { ProviderStatus } from '@/types'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])

const DOCUMENT_FIELDS = ['emirates_id', 'license', 'vehicle'] as const
type DocumentField = (typeof DOCUMENT_FIELDS)[number]

const DOCUMENT_KEYS: Record<DocumentField, string> = {
  emirates_id: 'emirates_id_url',
  license: 'license_url',
  vehicle: 'vehicle_photo_url',
}

function verifyMagicBytes(buffer: ArrayBuffer, mimeType: string): boolean {
  const bytes = new Uint8Array(buffer, 0, 8)
  if (mimeType === 'image/jpeg') {
    return bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  }
  if (mimeType === 'image/png') {
    return (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
    )
  }
  if (mimeType === 'application/pdf') {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  }
  return false
}

function extensionFor(file: File): string | null {
  if (file.type === 'image/jpeg') return 'jpg'
  if (file.type === 'image/png') return 'png'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

export async function POST(req: NextRequest) {
  const { user, authError } = await getRequestUser(req)

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = await checkRateLimitAsync(
    `documents-upload:${user.id}`,
    5,
    60 * 60 * 1000,
    'provider_documents_upload'
  )
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many upload attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only provider accounts can upload documents' }, { status: 403 })
  }

  const { data: currentProvider } = await admin
    .from('providers')
    .select('status, documents')
    .eq('id', user.id)
    .single<{ status: ProviderStatus; documents: Record<string, string> | null }>()

  const formData = await req.formData()
  const uploads: Record<string, string> = {}
  let uploadedCount = 0

  for (const field of DOCUMENT_FIELDS) {
    const value = formData.get(field)
    if (!(value instanceof File) || value.size === 0) continue

    if (value.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `${field} must be 5 MB or smaller` }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(value.type)) {
      return NextResponse.json({ error: `${field} must be JPG, PNG, or PDF` }, { status: 400 })
    }

    const extension = extensionFor(value)
    if (!extension) {
      return NextResponse.json({ error: `${field} has an unsupported file type` }, { status: 400 })
    }

    const fileBytes = await value.arrayBuffer()

    if (!verifyMagicBytes(fileBytes, value.type)) {
      return NextResponse.json({ error: `${field} content does not match its declared file type` }, { status: 400 })
    }

    const path = `${user.id}/${field}.${extension}`
    const { error: uploadError } = await admin.storage
      .from('provider-documents')
      .upload(path, fileBytes, { contentType: value.type, upsert: true })

    if (uploadError) {
      return NextResponse.json({ error: `Failed to upload ${field}` }, { status: 500 })
    }

    uploads[DOCUMENT_KEYS[field]] = path
    uploadedCount++
  }

  if (uploadedCount === 0) {
    return NextResponse.json({ error: 'At least one document is required' }, { status: 400 })
  }

  const mergedDocuments = { ...(currentProvider?.documents ?? {}), ...uploads }

  const currentStatus = currentProvider?.status ?? 'pending'
  const isActive = currentStatus === 'active'

  const newStatus: ProviderStatus = isActive ? 'active' : 'under_review'

  const { error: updateError } = await admin
    .from('providers')
    .update({ documents: mergedDocuments, status: newStatus })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save document records' }, { status: 500 })
  }

  if (isActive) {
    logger.info({
      event: 'provider_documents_updated_while_active',
      provider_id: user.id,
      uploaded_fields: Object.keys(uploads),
    })
  } else {
    logger.info({
      event: 'provider_documents_submitted_for_review',
      provider_id: user.id,
      previous_status: currentStatus,
      new_status: 'under_review',
      uploaded_fields: Object.keys(uploads),
    })
  }

  return NextResponse.json({ documents: mergedDocuments, status: newStatus })
}
