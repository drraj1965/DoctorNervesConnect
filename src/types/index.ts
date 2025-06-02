
import type { User as FirebaseUser } from 'firebase/auth';

export interface UserProfile extends FirebaseUser {
  role?: 'patient' | 'doctor';
}

export interface DoctorProfile extends UserProfile {
  specialization?: string;
}

export interface VideoComment {
  id: string; // Unique ID for the comment
  userId: string;
  userName: string;
  userPhotoUrl?: string; // Optional: for displaying avatar
  text: string;
  createdAt: string; // ISO date string
  parentId?: string | null; // For threading/replies
  replies?: VideoComment[]; // For nested display, though direct array update in Firestore is hard
}

export interface VideoMeta {
  id: string;
  title: string;
  description: string;
  doctorId: string;
  doctorName: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: string; 
  recordingDuration?: number; // duration in seconds, as a number
  tags: string[];
  createdAt: string; 
  viewCount: number;
  featured: boolean;
  permalink: string;
  storagePath: string; 
  thumbnailStoragePath: string; 
  videoSize?: number; 
  videoType?: string; 
  comments?: VideoComment[];
}

export interface Article {
  id: string;
  title: string;
  content: string; 
  doctorId: string;
  doctorName: string;
  tags: string[];
  createdAt: string; 
  updatedAt?: string; 
  isPublished: boolean;
}

export interface Question {
  id: string;
  patientId: string;
  patientName: string; 
  doctorId: string; 
  questionText: string;
  answerText?: string;
  isAnswered: boolean;
  createdAt: string; 
  answeredAt?: string; 
}
