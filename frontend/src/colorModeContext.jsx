import { createContext, useContext } from 'react'

export const ColorModeContext = createContext({ toggle: () => {}, mode: 'light' })
export const useColorMode = () => useContext(ColorModeContext)
