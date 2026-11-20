import { createContext } from 'react'
import type { FileScope } from '../api/queries'

/** Which target's files a note's `[file:<id>]` tokens refer to (the note's own email, card or project). */
export const NoteFilesContext = createContext<FileScope | null>(null)
