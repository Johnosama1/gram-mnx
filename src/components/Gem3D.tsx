import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Faceted hexagonal crystal — real geometry, spins forever. */
function Crystal({ speed }: { speed: number }) {
  const group = useRef<THREE.Group>(null);
  const shards = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const profile = [
      new THREE.Vector2(0.001, -1.55),
      new THREE.Vector2(0.42, -0.95),
      new THREE.Vector2(0.55, -0.55),
      new THREE.Vector2(0.55, 0.72),
      new THREE.Vector2(0.4, 1.05),
      new THREE.Vector2(0.001, 1.6),
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
          color="#b39bf5"
          emissive="#7c3aed"
          emissiveIntensity={0.28}
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
              color="#a78bfa"
              emissive="#8b5cf6"
              emissiveIntensity={0.35}
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
  useFrame((_, delta) => {
    if (ring.current) ring.current.rotation.y += Math.min(delta, 0.05) * speed * 0.4;
  });
  return (
    <group position={[0, -1.45, 0]}>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.86, 1.02, 64]} />
        <meshBasicMaterial color="#c4b5fd" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring} position={[0, 0.06, 0]}>
        <torusGeometry args={[0.8, 0.04, 16, 64]} />
        <meshStandardMaterial color="#c4b5fd" emissive="#8b5cf6" emissiveIntensity={2.2} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.78, 48]} />
        <meshBasicMaterial color="#ede9fe" transparent opacity={0.6} />
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
