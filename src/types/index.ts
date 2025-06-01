import type { User as FirebaseUser } from 'firebase/auth';

export interface UserProfile extends FirebaseUser {
  // Extend with custom properties if needed in the future
  // e.g. gender, dateOfBirth
  role?: 'patient' | 'doctor'; // Simplified role
}

export interface DoctorProfile extends UserProfile {
  specialization?: string;
  // other doctor-specific fields
}

export interface VideoComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string; // ISO date string
  replies?: VideoComment[];
}

export interface VideoMeta {
  id: string;
  title: string;
  description: string;
  doctorId: string;
  doctorName: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: string; // e.g., "00:12:34"
  recordingDuration?: number; // in seconds
  tags: string[];
  createdAt: string; // ISO date string
  viewCount: number;
  featured: boolean;
  permalink: string;
  storagePath: string; // path in Firebase Storage for video file
  thumbnailStoragePath: string; // path for thumbnail
  videoSize?: number; // in bytes
  videoType?: string; // e.g. "video/webm"
  comments?: VideoComment[];
}

export interface Article {
  id: string;
  title: string;
  content: string; // Could be markdown or rich text
  doctorId: string;
  doctorName: string;
  tags: string[];
  createdAt: string; // ISO date string
  updatedAt?: string; // ISO date string
  isPublished: boolean;
  // comments, shares, etc.
}

export interface Question {
  id: string;
  patientId: string;
  patientName: string; // Consider privacy, maybe anonymous option
  doctorId: string; // ID of the doctor question is addressed to
  questionText: string;
  answerText?: string;
  isAnswered: boolean;
  createdAt: string; // ISO date string
  answeredAt?: string; // ISO date string
  // conversations
}
