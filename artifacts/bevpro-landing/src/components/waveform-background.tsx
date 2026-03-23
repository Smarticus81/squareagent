import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export function WaveformBackground() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
      {/* Deep space radial gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(20,20,35,1)_0%,_rgba(5,5,8,1)_100%)]"></div>
      
      {/* Ethereal glowing orbs */}
      <motion.div 
        animate={{ 
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px] mix-blend-screen"
      />
      <motion.div 
        animate={{ 
          scale: [1, 1.5, 1],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] rounded-full bg-foreground/[0.06] blur-[150px] mix-blend-screen"
      />

      {/* Subtle particulate waveform */}
      <div className="absolute bottom-0 left-0 right-0 h-1/2 flex items-end justify-center gap-1 opacity-20 mask-image:linear-gradient(to_top,black,transparent)">
        {Array.from({ length: 40 }).map((_, i) => (
          <motion.div
            key={i}
            className="w-1 md:w-2 bg-primary rounded-t-full"
            initial={{ height: "10%" }}
            animate={{ 
              height: [`${10 + Math.random() * 20}%`, `${30 + Math.random() * 60}%`, `${10 + Math.random() * 20}%`] 
            }}
            transition={{
              duration: 2 + Math.random() * 2,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.1
            }}
          />
        ))}
      </div>
      
      {/* Overlay to fade bottom */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent"></div>
    </div>
  );
}
