
import type { User as FirebaseUser } from 'firebase/auth';

export interface UserProfile extends FirebaseUser {
  role?: 'patient' | 'doctor';
  // Consider adding other common user fields if they exist in 'users' collection
  // and are distinct from FirebaseUser default fields.
}

export interface DoctorProfile extends UserProfile {
  specialization?: string;
  firstName?: string; 
  lastName?: string;
  username?: string;
  doctor_email?: string; 
  doctor_mobile?: string;
  isAdmin?: boolean; 
}

export interface VideoComment {
  id: string; 
  userId: string;
  userName: string;
  userPhotoUrl?: string; 
  text: string;
  createdAt: string; // ISO date string
  parentId?: string | null; 
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
  duration: string; // Formatted string e.g., "01:23" or "01:23:45"
  recordingDuration?: number; // Actual duration in seconds, as a number
  tags: string[];
  createdAt: string; // ISO date string (or Firestore Timestamp on server, converted to string for client)
  viewCount: number;
  likeCount: number;
  commentCount: number;
  featured: boolean; // To show in "Recent Activities"
  permalink: string;
  storagePath: string; // Full path in Firebase Storage for the video file
  thumbnailStoragePath: string; // Full path in Firebase Storage for the thumbnail
  videoSize?: number; // File size in bytes
  videoType?: string; // Mime type e.g., "video/webm"
  comments?: VideoComment[];
}

// Type for data prepared by client (web recorder) before sending to server action
// Omits fields that are purely server-set or derived during the save process.
export type VideoDataForWebRecordCreation = Pick<VideoMeta, 
  'id' | 'title' | 'description' | 'doctorId' | 'doctorName' | 
  'videoUrl' | 'thumbnailUrl' | 'duration' | 'recordingDuration' | 
  'tags' | 'featured' | 'storagePath' | 'thumbnailStoragePath' | 
  'videoSize' | 'videoType'
>;


export interface Article {
  id: string;
  title: string;
  content: string; 
  doctorId: string;
  doctorName: string;
  tags: string[];
  createdAt: string; // ISO date string
  updatedAt?: string; // ISO date string
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
  createdAt: string; // ISO date string
  answeredAt?: string; // ISO date string
}
