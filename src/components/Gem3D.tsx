import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Soft white-to-transparent radial gradient, tinted by the sprite's own color. */
function useGlowTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, []);
}

/** Faceted hexagonal crystal — real geometry, spins forever. */
function Crystal({ speed }: { speed: number }) {
  const group = useRef<THREE.Group>(null);
  const shards = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const profile = [
      new THREE.Vector2(0.001, -1.85),
      new THREE.Vector2(0.3, -1.15),
      new THREE.Vector2(0.44, -0.55),
      new THREE.Vector2(0.44, 0.78),
      new THREE.Vector2(0.32, 1.2),
      new THREE.Vector2(0.001, 1.95),
    ];
    const g = new THREE.LatheGeometry(profile, 6);
    g.computeVertexNormals();
    return g;
  }, []);

  const shardData = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => {
        const a = (i / 11) * Math.PI * 2;
        return {
          angle: a,
          radius: 0.95 + (i % 3) * 0.16,
          y: -0.55 + ((i * 7) % 11) * 0.13,
          scale: 0.1 + ((i * 3) % 5) * 0.035,
          tilt: (i % 4) * 0.5,
        };
      }),
    [],
  );

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05);
    if (group.current) {
      group.current.rotation.y += d * speed;
      group.current.position.y = Math.sin(state.clock.elapsedTime * 1.1) * 0.06;
    }
    if (shards.current) {
      shards.current.rotation.y -= d * speed * 0.55;
    }
  });

  return (
    <group ref={group} position={[0, 0.55, 0]}>
      <mesh geometry={geometry} castShadow>
        <meshPhysicalMaterial
          color="#7c3aed"
          emissive="#a855f7"
          emissiveIntensity={0.4}
          metalness={0}
          roughness={0.06}
          transmission={0.75}
          thickness={1.6}
          ior={1.8}
          clearcoat={1}
          clearcoatRoughness={0.05}
          flatShading
          transparent
          opacity={0.96}
        />
      </mesh>

      <group ref={shards}>
        {shardData.map((s, i) => (
          <mesh
            key={i}
            position={[Math.cos(s.angle) * s.radius, s.y, Math.sin(s.angle) * s.radius]}
            rotation={[s.tilt, s.angle, s.tilt * 0.7]}
            scale={[s.scale, s.scale * 2.2, s.scale]}
          >
            <octahedronGeometry args={[1, 0]} />
            <meshPhysicalMaterial
              color="#8b5cf6"
              emissive="#a855f7"
              emissiveIntensity={0.4}
              roughness={0.08}
              metalness={0}
              transmission={0.6}
              thickness={0.5}
              ior={1.7}
              flatShading
              transparent
              opacity={0.95}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Glowing tech pedestal under the crystal. */
function Pedestal({ speed }: { speed: number }) {
  const ring = useRef<THREE.Mesh>(null);
  const glowTexture = useGlowTexture();
  useFrame((_, delta) => {
    if (ring.current) ring.current.rotation.y += Math.min(delta, 0.05) * speed * 0.4;
  });
  return (
    <group position={[0, -1.35, 0]}>
      {/* Soft purple aura haloing the base — a radial-gradient sprite (true
          falloff to transparent at the edge), additive + no depth write, so
          it glows behind the crystal/pedestal without ever occluding them. */}
      <sprite position={[0, 0.35, -0.3]} scale={[3.4, 1.9, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#c026d3"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.66, 0.92, 64]} />
        <meshStandardMaterial color="#1a1625" metalness={0.6} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.045, 16, 64]} />
        <meshStandardMaterial color="#d946ef" emissive="#c026d3" emissiveIntensity={2.6} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 48]} />
        <meshBasicMaterial color="#f5f3ff" transparent opacity={0.9} />
      </mesh>
      {/* Beam of light shooting up through the gem, like the original art. */}
      <mesh position={[0, 1.75, 0]}>
        <coneGeometry args={[0.22, 3.5, 24, 1, true]} />
        <meshBasicMaterial
          color="#e9d5ff"
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default function Gem3D({ active = true }: { active?: boolean }) {
  const speed = active ? 0.85 : 0.18;
  return (
    <Canvas
      camera={{ position: [0, 0.1, 8.2], fov: 34 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} color="#ffffff" />
      <pointLight position={[-3, 1, 2]} intensity={18} color="#a855f7" />
      <pointLight position={[0, -1.2, 2.4]} intensity={22} color="#e9e4ff" />
      <Crystal speed={speed} />
      <Pedestal speed={speed} />
    </Canvas>
  );
}
