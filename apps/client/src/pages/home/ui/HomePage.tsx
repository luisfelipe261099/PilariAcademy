import { HeroSection } from './sections/HeroSection'
import { FeaturedSection } from './sections/FeaturedSection'
import { CourseCatalog } from '@/widgets/course-catalog'

export function HomePage() {
  return (
    <>
      <HeroSection />
      <FeaturedSection />
      <CourseCatalog />
    </>
  )
}
