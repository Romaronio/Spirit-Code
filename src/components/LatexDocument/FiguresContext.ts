import { createContext } from 'react'
import type { TikzFigure } from '../../types'

// Рисунки TikZ открытого урока: их собирает сервер, документ находит свой по тексту рисунка
export const FiguresContext = createContext<TikzFigure[]>([])
