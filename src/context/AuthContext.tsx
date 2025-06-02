
"use client";

import type { User as FirebaseUser } from "firebase/auth";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { auth, db } from "@/lib/firebase/config";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import type { UserProfile, DoctorProfile } from "@/types";

interface AuthContextType {
  user: UserProfile | null;
  doctorProfile: DoctorProfile | null;
  isAdmin: boolean;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        let userProfileData: UserProfile = { ...firebaseUser } as UserProfile;

        if (userDocSnap.exists()) {
           userProfileData = { ...userProfileData, ...userDocSnap.data() } as UserProfile;
        }
        
        setUser(userProfileData);

        const doctorDocRef = doc(db, "doctors", firebaseUser.uid);
        const doctorDocSnap = await getDoc(doctorDocRef);
        if (doctorDocSnap.exists()) {
          const doctorData = doctorDocSnap.data();
          console.log("AuthContext: Doctor document data for UID", firebaseUser.uid, ":", JSON.stringify(doctorData));
          // Client-side isAdmin for UI convenience. Firestore rules are the source of truth for permissions.
          setIsAdmin(true); 
          setDoctorProfile({ ...userProfileData, ...doctorData } as DoctorProfile);
          userProfileData.role = 'doctor';
        } else {
          console.log("AuthContext: No doctor document found for UID", firebaseUser.uid);
          setIsAdmin(false);
          setDoctorProfile(null);
          if (!userProfileData.role) userProfileData.role = 'patient'; 
        }
        setUser(userProfileData); 
      } else {
        setUser(null);
        setIsAdmin(false);
        setDoctorProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await auth.signOut();
    setUser(null);
    setIsAdmin(false);
    setDoctorProfile(null);
  };
  
  return (
    <AuthContext.Provider value={{ user, doctorProfile, isAdmin, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

