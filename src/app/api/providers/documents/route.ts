import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestUser } from '@/lib/supabase/request-user'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const DOCUMENT_FIELDS = ['emirates_id', 'license', 'vehicle'] as const

type DocumentField = (typeof DOCUMENT_FIELDS)[number]

const DOCUMENT_KEYS: Record<DocumentField, string> = {
  emirates_id: 'emirates_id_url',
  license: 'license_url',
  vehicle: 'vehicle_photo_url',
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

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'provider') {
    return NextResponse.json({ error: 'Only provider accounts can upload documents' }, { status: 403 })
  }

  const formData = await req.formData()
  const uploads: Record<string, string> = {}

  for (const field of DOCUMENT_FIELDS) {
    const value = formData.get(field)

    if (!(value instanceof File)) {
      return NextResponse.json({ error: `Missing required document: ${field}` }, { status: 400 })
    }

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

    const path = `${user.id}/${field}.${extension}`
    const fileBytes = await value.arrayBuffer()
    const { error: uploadError } = await admin.storage
      .from('provider-documents')
      .upload(path, fileBytes, {
        contentType: value.type,
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json({ error: `Failed to upload ${field}` }, { status: 500 })
    }

    uploads[DOCUMENT_KEYS[field]] = path
  }

  const { error: updateError } = await admin
    .from('providers')
    .update({ documents: uploads, status: 'pending' })
    .eq('id', user.id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save document records' }, { status: 500 })
  }

  return NextResponse.json({ documents: uploads })
}
